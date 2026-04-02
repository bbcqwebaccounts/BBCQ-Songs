import { useState, useEffect } from 'react';
import { collection, getDocs, doc, setDoc, writeBatch, onSnapshot, query } from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../firebase';
import { ServiceData, SongMeta } from '../types';
import localforage from 'localforage';
import defaultData from '../defaultData.json';

interface UseFirebaseDataProps {
  setServices: (services: ServiceData[]) => void;
  setSongMetadata: (metadata: Record<string, SongMeta>) => void;
  setMasterSongs: (songs: any[]) => void;
  setIsLoaded: (loaded: boolean) => void;
  setSyncStatus: (status: string) => void;
  setLastSyncTime: (time: Date) => void;
}

export function useFirebaseData({
  setServices,
  setSongMetadata,
  setMasterSongs,
  setIsLoaded,
  setSyncStatus,
  setLastSyncTime
}: UseFirebaseDataProps) {
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      setUserId(user ? user.uid : null);
      setUserEmail(user?.email || null);
      if (user) {
        try {
          const { doc, getDoc } = await import('firebase/firestore');
          const userDoc = await getDoc(doc(db, 'users', user.email || ''));
          if (userDoc.exists() && userDoc.data().role === 'admin') {
            setIsAdmin(true);
          } else {
            setIsAdmin(user.email === 'johanson_ben@hotmail.com');
          }
        } catch (error) {
          setIsAdmin(user.email === 'johanson_ben@hotmail.com');
          console.warn('Failed to load user role from Firestore.', error);
        }
      } else {
        setIsAdmin(false);
      }
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!isAuthReady) {
      return;
    }

    setSyncStatus('Loading data from Firebase...');
    
    let unsubscribeServices: () => void;
    let unsubscribeSongs: () => void;

    const loadData = async () => {
      try {
        // Check if we need to migrate data
        const servicesSnapshot = await getDocs(collection(db, 'services'));
        
        if (servicesSnapshot.empty) {
          setSyncStatus('Migrating local data to Firebase...');
          await migrateDataToFirebase();
        }

        // Setup real-time listeners
        unsubscribeServices = onSnapshot(collection(db, 'services'), (snapshot) => {
          const loadedServices: ServiceData[] = [];
          snapshot.forEach((doc) => {
            const data = doc.data();
            loadedServices.push({
              id: doc.id,
              date: new Date(data.date),
              fileName: data.fileName || '',
              serviceType: data.serviceType,
              songs: data.songs || []
            });
          });
          // Sort by date descending
          loadedServices.sort((a, b) => b.date.getTime() - a.date.getTime());
          setServices(loadedServices);
          setLastSyncTime(new Date());
        }, (error) => {
          handleFirestoreError(error, OperationType.LIST, 'services');
        });

        unsubscribeSongs = onSnapshot(collection(db, 'songs'), (snapshot) => {
          const loadedMasterSongs: any[] = [];
          const loadedSongMetadata: Record<string, SongMeta> = {};
          
          snapshot.forEach((doc) => {
            const data = doc.data();
            if (!data.title) {
              return;
            }

            loadedMasterSongs.push({
              ...data,
            });
            
            loadedSongMetadata[data.title] = {
              lyrics: data.lyrics || '',
              themes: data.themes || [],
              parts: data.parts || [],
              verse_order: data.verse_order,
              embedding: data.embedding,
              embeddingProvider: data.embeddingProvider
            };
          });
          
          setMasterSongs(loadedMasterSongs);
          setSongMetadata(loadedSongMetadata);
          setIsLoaded(true);
          setSyncStatus('');
          setLastSyncTime(new Date());
        }, (error) => {
          setIsLoaded(true);
          setSyncStatus('');
          handleFirestoreError(error, OperationType.LIST, 'songs');
        });

      } catch (error) {
        setIsLoaded(true);
        setSyncStatus('');
        handleFirestoreError(error, OperationType.GET, 'services/songs');
      }
    };

    loadData();

    return () => {
      if (unsubscribeServices) unsubscribeServices();
      if (unsubscribeSongs) unsubscribeSongs();
    };
  }, [isAuthReady]);

  const migrateDataToFirebase = async () => {
    try {
      const storedServices = await localforage.getItem<ServiceData[]>('services') || defaultData.services as any[];
      const storedSongMetadata = await localforage.getItem<Record<string, SongMeta>>('songMetadata') || defaultData.songMetadata as any;
      const storedMasterSongs = await localforage.getItem<any[]>('masterSongs') || defaultData.masterSongs as any[];

      // We need to batch writes (max 500 per batch)
      let batch = writeBatch(db);
      let count = 0;

      // Migrate Services
      for (const service of storedServices) {
        const serviceRef = doc(collection(db, 'services'));
        batch.set(serviceRef, {
          date: new Date(service.date).toISOString().split('T')[0],
          fileName: service.fileName || '',
          serviceType: service.serviceType,
          songs: service.songs || []
        });
        count++;
        if (count === 400) {
          await batch.commit();
          batch = writeBatch(db);
          count = 0;
        }
      }

      // Migrate Songs
      // Combine masterSongs and songMetadata
      const allSongTitles = new Set([
        ...storedMasterSongs.map(s => s.title),
        ...Object.keys(storedSongMetadata)
      ]);

      for (const title of allSongTitles) {
        const masterSong = storedMasterSongs.find(s => s.title === title) || {};
        const meta = storedSongMetadata[title] || {};
        
        // Sanitize title for document ID (replace slashes)
        const safeId = title.replace(/\//g, '_');
        const songRef = doc(db, 'songs', safeId);
        
        const songData: any = {
          title: title,
        };
        if (masterSong.alternate_title) songData.alternate_title = masterSong.alternate_title;
        if (masterSong.lyrics || meta.lyrics) songData.lyrics = masterSong.lyrics || meta.lyrics;
        if (masterSong.author) songData.author = masterSong.author;
        if (masterSong.ccli_number) songData.ccli_number = masterSong.ccli_number;
        if (meta.themes && meta.themes.length > 0) songData.themes = meta.themes;
        if (meta.embedding) songData.embedding = meta.embedding;

        batch.set(songRef, songData);
        count++;
        if (count === 400) {
          await batch.commit();
          batch = writeBatch(db);
          count = 0;
        }
      }

      if (count > 0) {
        await batch.commit();
      }
      console.log('Migration complete');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'songs/services');
    }
  };

  return { isAuthReady, userId, userEmail, isAdmin };
}
