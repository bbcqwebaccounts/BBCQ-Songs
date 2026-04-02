import React, { useState } from 'react';
import initSqlJs from 'sql.js';
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { ServiceData, SongMeta } from '../types';
import { processFile } from '../lib/fileProcessing';
import { parseOpenLPLyrics } from '../lib/songUtils';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { doc, writeBatch, collection } from 'firebase/firestore';
import {
  getFirebaseActionMessage,
  replaceFirebaseBackupData,
  sanitizeSongForFirestore,
} from '../lib/firebaseData';
import { generateJsonWithFallback } from '../lib/aiClient';

import { toast } from 'sonner';

interface UseFileHandlerProps {
  masterSongs: any[];
  setMasterSongs: React.Dispatch<React.SetStateAction<any[]>>;
  services: ServiceData[];
  setServices: React.Dispatch<React.SetStateAction<ServiceData[]>>;
  songMetadata: Record<string, SongMeta>;
  setProcessingFiles: React.Dispatch<React.SetStateAction<number>>;
  setPendingConsolidationCheck: React.Dispatch<React.SetStateAction<boolean>>;
}

export interface HandleFilesOptions {
  jsonMode?: 'merge' | 'replace';
}

export const useFileHandler = ({
  masterSongs,
  setMasterSongs,
  services,
  setServices,
  songMetadata,
  setProcessingFiles,
  setPendingConsolidationCheck
}: UseFileHandlerProps) => {

  const handleFiles = async (
    files: FileList | File[],
    options: HandleFilesOptions = {},
  ) => {
    const fileArray = Array.from(files);
    const sqliteFiles = fileArray.filter(f => f.name.toLowerCase().endsWith('.sqlite') || f.name.toLowerCase().endsWith('.db'));
    const jsonFiles = fileArray.filter(f => f.name.toLowerCase().endsWith('.json'));
    const oszFiles = fileArray.filter(f => f.name.toLowerCase().endsWith('.osz') || f.name.toLowerCase().endsWith('.zip') || f.name.toLowerCase().endsWith('.osj'));
    const jsonMode = options.jsonMode || 'merge';
    
    let currentMasterSongs = [...masterSongs];

    if (sqliteFiles.length > 0) {
      for (const file of sqliteFiles) {
        try {
          const SQL = await initSqlJs({
            locateFile: () => sqlWasmUrl
          });
          const buffer = await file.arrayBuffer();
          const database = new SQL.Database(new Uint8Array(buffer));
          
          try {
            const res = database.exec("SELECT * FROM songs");
            if (res.length > 0) {
              const columns = res[0].columns;
              const values = res[0].values;
              const songs = values.map(row => {
                const song: any = {};
                columns.forEach((col, i) => {
                  if (col === 'lyrics' && typeof row[i] === 'string') {
                    const parsed = parseOpenLPLyrics(row[i] as string);
                    if (typeof parsed === 'string') {
                      song[col] = parsed;
                    } else {
                      song[col] = parsed.text;
                      song.parts = parsed.parts;
                    }
                  } else {
                    song[col] = row[i];
                  }
                });
                return song;
              });
              
              const batch = writeBatch(db);
              songs.forEach(song => {
                const safeId = song.title.replace(/\//g, '_');
                const songRef = doc(db, 'songs', safeId);
                batch.set(songRef, sanitizeSongForFirestore(song), { merge: true });
              });
              try {
                await batch.commit();
              } catch (error) {
                handleFirestoreError(error, OperationType.WRITE, 'songs');
              }
              
              currentMasterSongs = songs;
              toast.success(`Successfully loaded ${songs.length} songs from the database as the source of truth.`);
            } else {
              toast.error("The database was loaded, but the 'songs' table is empty.");
            }
          } catch (e) {
            console.error("Error reading songs table", e);
            toast.error("Could not read the 'songs' table from the database. Make sure it's a valid OpenLP or similar song database.");
          }
        } catch (e) {
          console.error("Failed to load SQLite database", e);
          toast.error("Failed to load the SQLite database.");
        }
      }
    }

    if (jsonFiles.length > 0) {
      for (const file of jsonFiles) {
        try {
          const text = await file.text();
          const data = JSON.parse(text);

          if (jsonMode === 'replace') {
            const result = await replaceFirebaseBackupData(data);
            toast.success(
              `Replaced Firebase data with ${result.songsCount} songs and ${result.servicesCount} services from ${file.name}.`,
            );
            continue;
          }

          let batch = writeBatch(db);
          let count = 0;
          
          const commitBatch = async () => {
            if (count > 0) {
              try {
                await batch.commit();
              } catch (error) {
                handleFirestoreError(error, OperationType.WRITE, 'import');
              }
              batch = writeBatch(db);
              count = 0;
            }
          };

          let parsedServices: any[] = [];
          if (Array.isArray(data)) {
            parsedServices = data.map((s: any) => ({
              ...s,
              date: new Date(s.date)
            }));
          } else if (data && data.services && data.songMetadata) {
            parsedServices = data.services.map((s: any) => ({
              ...s,
              date: new Date(s.date)
            }));
            
            for (const [title, meta] of Object.entries(data.songMetadata)) {
              const safeId = title.replace(/\//g, '_');
              const songRef = doc(db, 'songs', safeId);
              batch.set(songRef, sanitizeSongForFirestore({ title, ...(meta as any) }), { merge: true });
              count++;
              if (count >= 400) await commitBatch();
            }

            if (data.masterSongs && Array.isArray(data.masterSongs)) {
              for (const song of data.masterSongs) {
                const safeId = song.title.replace(/\//g, '_');
                const songRef = doc(db, 'songs', safeId);
                batch.set(songRef, sanitizeSongForFirestore(song), { merge: true });
                count++;
                if (count >= 400) await commitBatch();
              }
            }
          }
          
          const existingKeys = new Set(services.map(s => `${s.date.getTime()}-${s.serviceType}`));
          const uniqueNew = parsedServices.filter((s: any) => !existingKeys.has(`${s.date.getTime()}-${s.serviceType}`));
          
          for (const service of uniqueNew) {
            const serviceRef = doc(collection(db, 'services'));
            batch.set(serviceRef, {
              date: service.date.toISOString().split('T')[0],
              fileName: service.fileName || '',
              serviceType: service.serviceType,
              songs: service.songs || []
            });
            count++;
            if (count >= 400) await commitBatch();
          }
          
          await commitBatch();
          toast.success("Successfully imported backup file to database.");
        } catch (e) {
          console.error("Failed to parse JSON", e);
          toast.error(
            getFirebaseActionMessage(e, 'Invalid backup file.'),
          );
        }
      }
    }

    if (oszFiles.length === 0) return;

    setProcessingFiles(oszFiles.length);
    const newServices: ServiceData[] = [];
    const newMetadata: Record<string, SongMeta> = {};
    
    for (const file of oszFiles) {
      const result = await processFile(file, currentMasterSongs);
      if (result) {
        newServices.push(result.service);
        Object.assign(newMetadata, result.metadata);
      }
      setProcessingFiles(prev => Math.max(0, prev - 1));
    }

    const songsToTag = Object.keys(newMetadata).filter(title => {
      const existing = songMetadata[title];
      return !existing?.themes || existing.themes.length === 0;
    });

    if (songsToTag.length > 0) {
      setProcessingFiles(songsToTag.length); // Reuse processingFiles for tagging progress
      const batchSize = 10;
      const batches = [];
      for (let i = 0; i < songsToTag.length; i += batchSize) {
        batches.push(songsToTag.slice(i, i + batchSize));
      }

      for (const batch of batches) {
        const prompt = `Analyze the following worship songs and provide up to 5 thematic tags for each (e.g., Christ, Easter, Redemption, Sin, Suffering, Happiness, Salvation, Grace, Faith, etc.). Return ONLY a JSON object where the keys are the song titles and the values are arrays of strings (the tags).\n\n` + batch.map(title => `Title: ${title}\nLyrics:\n${newMetadata[title].lyrics}`).join('\n\n---\n\n');
        
        try {
          const { result: tags } = await generateJsonWithFallback<Record<string, string[]>>(prompt);
          for (const title of batch) {
            if (tags[title]) {
              newMetadata[title].themes = tags[title];
            }
          }
        } catch (e) {
          console.error("Failed to tag songs", e);
        }
        setProcessingFiles(prev => Math.max(0, prev - batch.length));
        
        // Add a small delay between batches to avoid rate limits
        if (batches.length > 1) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
    }

    const batch = writeBatch(db);
    
    Object.entries(newMetadata).forEach(([title, meta]) => {
      const safeId = title.replace(/\//g, '_');
      const songRef = doc(db, 'songs', safeId);
      batch.set(songRef, sanitizeSongForFirestore({ title, ...meta }), { merge: true });
    });

    const existingKeys = new Set(services.map(s => `${s.date.getTime()}-${s.serviceType}`));
    const uniqueNew = newServices.filter((s: any) => !existingKeys.has(`${s.date.getTime()}-${s.serviceType}`));
    
    uniqueNew.forEach(service => {
      const serviceRef = doc(collection(db, 'services'));
      batch.set(serviceRef, {
        date: service.date.toISOString().split('T')[0],
        fileName: service.fileName || '',
        serviceType: service.serviceType,
        songs: service.songs || []
      });
    });

    try {
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'services');
    }
    setPendingConsolidationCheck(true);
  };

  return { handleFiles };
};
