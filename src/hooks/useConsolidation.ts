import { useState, useCallback, useEffect } from 'react';
import { ServiceData, SongMeta } from '../types';
import { matchSong, getFirstLine } from '../lib/songUtils';
import { db } from '../firebase';
import { doc, writeBatch, deleteDoc } from 'firebase/firestore';
import { handleFirestoreError, OperationType } from '../firebase';
import { toast } from 'sonner';

interface UseConsolidationProps {
  masterSongs: any[];
  services: ServiceData[];
  songMetadata: Record<string, SongMeta>;
  setServices: (services: ServiceData[]) => void;
  setMasterSongs: (songs: any[]) => void;
  pendingConsolidationCheck: boolean;
  setPendingConsolidationCheck: (pending: boolean) => void;
}

export function useConsolidation({
  masterSongs,
  services,
  songMetadata,
  setServices,
  setMasterSongs,
  pendingConsolidationCheck,
  setPendingConsolidationCheck
}: UseConsolidationProps) {
  const [isConsolidateDialogOpen, setIsConsolidateDialogOpen] = useState(false);
  const [consolidationTasks, setConsolidationTasks] = useState<{
    originalTitle: string;
    originalFirstLine: string;
    suggestedMatch: string | null;
    selectedMatch: string | null;
    status: 'exact' | 'auto' | 'manual' | 'unmatched' | 'new';
  }[]>([]);
  const [consolidationFilter, setConsolidationFilter] = useState<'unmatched' | 'auto' | 'exact' | 'manual' | 'new' | 'all'>('unmatched');

  const startConsolidation = useCallback(() => {
    if (masterSongs.length === 0) {
      toast.error('Upload the SQLite song database first so consolidation has a source of truth.');
      return;
    }

    const uniqueServiceSongs = new Set<string>();
    services.forEach(s => s.songs.forEach(title => uniqueServiceSongs.add(title)));

    const tasks = Array.from(uniqueServiceSongs).map(oldTitle => {
      const lyrics = songMetadata[oldTitle]?.lyrics || '';
      const firstLine = getFirstLine(lyrics);
      
      const matchedTitle = matchSong(oldTitle, lyrics, masterSongs);
      let status: 'exact' | 'auto' | 'unmatched' = 'unmatched';
      let match = null;

      if (matchedTitle) {
        if (matchedTitle === oldTitle) {
          status = 'exact';
        } else {
          status = 'auto';
        }
        match = matchedTitle;
      }

      return {
        originalTitle: oldTitle,
        originalFirstLine: firstLine,
        suggestedMatch: match,
        selectedMatch: match,
        status
      };
    });

    // Sort unmatched first
    tasks.sort((a, b) => {
      if (a.status === 'unmatched' && b.status !== 'unmatched') return -1;
      if (a.status !== 'unmatched' && b.status === 'unmatched') return 1;
      return a.originalTitle.localeCompare(b.originalTitle);
    });

    setConsolidationTasks(tasks);
    setConsolidationFilter('unmatched');
    
    // Only open dialog if there are unmatched or auto-matched songs
    if (tasks.some(t => t.status === 'unmatched' || t.status === 'auto')) {
      setIsConsolidateDialogOpen(true);
    } else {
      toast.success('No consolidation work is needed right now.');
    }
  }, [masterSongs, services, songMetadata]);

  useEffect(() => {
    if (pendingConsolidationCheck && services.length > 0 && masterSongs.length > 0) {
      startConsolidation();
      setPendingConsolidationCheck(false);
    }
  }, [pendingConsolidationCheck, services, masterSongs, startConsolidation, setPendingConsolidationCheck]);

  const applyConsolidation = async () => {
    let mergedCount = 0;
    let addedCount = 0;
    const titleMap = new Map<string, string>();
    const batch = writeBatch(db);

    consolidationTasks.forEach(task => {
      if (task.status === 'new') {
        // Add as new song
        const newSong = {
          title: task.originalTitle,
          lyrics: songMetadata[task.originalTitle]?.lyrics || '',
          themes: songMetadata[task.originalTitle]?.themes || []
        };
        const safeId = task.originalTitle.replace(/\//g, '_');
        const songRef = doc(db, 'songs', safeId);
        batch.set(songRef, newSong, { merge: true });
        addedCount++;
      } else if (task.selectedMatch && task.selectedMatch !== task.originalTitle) {
        titleMap.set(task.originalTitle, task.selectedMatch);
        mergedCount++;
        
        const oldTitle = task.originalTitle;
        const matchedTitle = task.selectedMatch;

        const mergedMetadata: any = { ...songMetadata[matchedTitle] };
        
        // Combine themes if both have them
        const existingThemes = new Set(mergedMetadata.themes || []);
        (songMetadata[oldTitle]?.themes || []).forEach(t => existingThemes.add(t));
        mergedMetadata.themes = Array.from(existingThemes);
        
        // Keep the master lyrics if available, otherwise use the old one
        if (!mergedMetadata.lyrics && songMetadata[oldTitle]?.lyrics) {
          mergedMetadata.lyrics = songMetadata[oldTitle].lyrics;
        }
        
        const safeMatchedId = matchedTitle.replace(/\//g, '_');
        const matchedRef = doc(db, 'songs', safeMatchedId);
        batch.set(matchedRef, mergedMetadata, { merge: true });
        
        // Delete old metadata
        const safeOldId = oldTitle.replace(/\//g, '_');
        const oldRef = doc(db, 'songs', safeOldId);
        batch.delete(oldRef);
      }
    });

    // Second pass: update services with new titles
    services.forEach(service => {
      let changed = false;
      const newSongs = service.songs.map(title => {
        if (titleMap.has(title)) {
          changed = true;
          return titleMap.get(title)!;
        }
        return title;
      });
      
      if (changed && service.id) {
        const uniqueSongs = Array.from(new Set(newSongs));
        const serviceRef = doc(db, 'services', service.id);
        batch.update(serviceRef, { songs: uniqueSongs });
      }
    });

    try {
      await batch.commit();
      setIsConsolidateDialogOpen(false);
      toast.success(`Consolidation complete. Merged ${mergedCount} songs and added ${addedCount} new ones.`);
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, 'songs/services');
    }
  };

  return {
    isConsolidateDialogOpen,
    setIsConsolidateDialogOpen,
    consolidationTasks,
    setConsolidationTasks,
    consolidationFilter,
    setConsolidationFilter,
    startConsolidation,
    applyConsolidation
  };
}
