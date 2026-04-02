import localforage from 'localforage';
import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';
import { SongMeta, ServiceData } from '../types';
import { parseOpenLPLyrics } from './songUtils';

type RawService = Omit<ServiceData, 'date'> & { date: Date | string };

export interface BackupDataPayload {
  services?: RawService[];
  songMetadata?: Record<string, SongMeta>;
  masterSongs?: any[];
}

export interface NormalizedBackupData {
  services: ServiceData[];
  songMetadata: Record<string, SongMeta>;
  masterSongs: any[];
}

export const getSongDocId = (title: string) => title.replace(/\//g, '_');

export function getFirebaseActionMessage(error: unknown, fallback: string) {
  const code =
    typeof error === 'object' && error && 'code' in error
      ? String((error as { code?: unknown }).code || '')
      : '';

  if (code.includes('permission-denied')) {
    return 'This action requires admin access in Firebase.';
  }

  if (code.includes('unauthenticated')) {
    return 'You need to sign in before doing this.';
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}

export function normalizeBackupData(raw: unknown): NormalizedBackupData {
  if (Array.isArray(raw)) {
    return {
      services: raw.map(normalizeServiceRecord),
      songMetadata: {},
      masterSongs: [],
    };
  }

  const payload = (raw || {}) as BackupDataPayload;

  return {
    services: Array.isArray(payload.services)
      ? payload.services.map(normalizeServiceRecord)
      : [],
    songMetadata:
      payload.songMetadata && typeof payload.songMetadata === 'object'
        ? payload.songMetadata
        : {},
    masterSongs: Array.isArray(payload.masterSongs) ? payload.masterSongs : [],
  };
}

export async function replaceFirebaseBackupData(raw: unknown) {
  const data = normalizeBackupData(raw);

  await clearFirestoreCollection('services');
  await clearFirestoreCollection('songs');
  await writeSongsToFirestore(data.songMetadata, data.masterSongs);
  await writeServicesToFirestore(data.services);
  await syncLocalBackupCache(data);

  return {
    servicesCount: data.services.length,
    songsCount: buildUnifiedSongRecords(data.songMetadata, data.masterSongs).length,
  };
}

export async function deleteSongEverywhere(title: string) {
  const servicesSnapshot = await getDocs(collection(db, 'services'));
  let batch = writeBatch(db);
  let count = 0;

  const queueDelete = async (ref: any) => {
    batch.delete(ref);
    count += 1;
    if (count >= 400) {
      await batch.commit();
      batch = writeBatch(db);
      count = 0;
    }
  };

  const queueUpdate = async (ref: any, songs: string[]) => {
    batch.update(ref, { songs });
    count += 1;
    if (count >= 400) {
      await batch.commit();
      batch = writeBatch(db);
      count = 0;
    }
  };

  await queueDelete(doc(db, 'songs', getSongDocId(title)));

  for (const serviceDoc of servicesSnapshot.docs) {
    const serviceSongs = Array.isArray(serviceDoc.data().songs)
      ? (serviceDoc.data().songs as string[])
      : [];

    if (!serviceSongs.includes(title)) {
      continue;
    }

    await queueUpdate(
      doc(db, 'services', serviceDoc.id),
      serviceSongs.filter((song) => song !== title),
    );
  }

  if (count > 0) {
    await batch.commit();
  }
}

export async function updateSongDetailsInFirebase({
  currentTitle,
  nextTitle,
  lyrics,
  existingSong,
}: {
  currentTitle: string;
  nextTitle: string;
  lyrics: string;
  existingSong: Record<string, any>;
}) {
  const trimmedTitle = nextTitle.trim();

  if (!trimmedTitle) {
    throw new Error('Song title is required.');
  }

  const currentId = getSongDocId(currentTitle);
  const nextId = getSongDocId(trimmedTitle);

  if (currentTitle !== trimmedTitle) {
    const existingTarget = await getDoc(doc(db, 'songs', nextId));
    if (existingTarget.exists()) {
      throw new Error(`A song named "${trimmedTitle}" already exists.`);
    }
  }

  const cleanedLyrics = lyrics.trim();
  const parsedLyrics = parseOpenLPLyrics(cleanedLyrics);
  const normalizedLyrics =
    typeof parsedLyrics === 'string' ? parsedLyrics : parsedLyrics.text;
  const lyricsChanged = (existingSong.lyrics || '') !== normalizedLyrics;

  const songPayload: Record<string, any> = {
    ...existingSong,
    title: trimmedTitle,
    lyrics: normalizedLyrics,
    search_title: deleteField(),
    search_lyrics: deleteField(),
  };

  if (lyricsChanged) {
    songPayload.last_modified = new Date().toISOString();
    songPayload.verse_order = deleteField();
    if (typeof parsedLyrics === 'string') {
      songPayload.parts = deleteField();
    } else {
      songPayload.parts = parsedLyrics.parts;
    }
  }

  const servicesSnapshot =
    currentTitle === trimmedTitle
      ? null
      : await getDocs(collection(db, 'services'));

  let batch = writeBatch(db);
  let count = 0;

  const commitIfNeeded = async () => {
    if (count >= 400) {
      await batch.commit();
      batch = writeBatch(db);
      count = 0;
    }
  };

  if (currentTitle === trimmedTitle) {
    batch.set(doc(db, 'songs', currentId), songPayload, { merge: true });
    count += 1;
    await commitIfNeeded();
  } else {
    batch.set(doc(db, 'songs', nextId), songPayload);
    count += 1;
    await commitIfNeeded();

    batch.delete(doc(db, 'songs', currentId));
    count += 1;
    await commitIfNeeded();

    for (const serviceDoc of servicesSnapshot?.docs || []) {
      const serviceSongs = Array.isArray(serviceDoc.data().songs)
        ? (serviceDoc.data().songs as string[])
        : [];

      if (!serviceSongs.includes(currentTitle)) {
        continue;
      }

      const updatedSongs = Array.from(
        new Set(
          serviceSongs.map((song) =>
            song === currentTitle ? trimmedTitle : song,
          ),
        ),
      );

      batch.update(doc(db, 'services', serviceDoc.id), {
        songs: updatedSongs,
      });
      count += 1;
      await commitIfNeeded();
    }
  }

  if (count > 0) {
    await batch.commit();
  }

  return {
    title: trimmedTitle,
    lyrics: normalizedLyrics,
  };
}

function normalizeServiceRecord(service: RawService): ServiceData {
  return {
    ...service,
    date: service.date instanceof Date ? service.date : new Date(service.date),
    fileName: service.fileName || '',
    songs: Array.isArray(service.songs) ? service.songs : [],
    serviceType: service.serviceType === 'PM' ? 'PM' : 'AM',
  };
}

async function clearFirestoreCollection(collectionName: 'services' | 'songs') {
  const snapshot = await getDocs(collection(db, collectionName));
  let batch = writeBatch(db);
  let count = 0;

  for (const existingDoc of snapshot.docs) {
    batch.delete(doc(db, collectionName, existingDoc.id));
    count += 1;

    if (count >= 400) {
      await batch.commit();
      batch = writeBatch(db);
      count = 0;
    }
  }

  if (count > 0) {
    await batch.commit();
  }
}

async function writeServicesToFirestore(services: ServiceData[]) {
  let batch = writeBatch(db);
  let count = 0;

  for (const service of services) {
    batch.set(doc(collection(db, 'services')), {
      date: service.date.toISOString().split('T')[0],
      fileName: service.fileName || '',
      serviceType: service.serviceType,
      songs: Array.isArray(service.songs) ? service.songs : [],
    });
    count += 1;

    if (count >= 400) {
      await batch.commit();
      batch = writeBatch(db);
      count = 0;
    }
  }

  if (count > 0) {
    await batch.commit();
  }
}

async function writeSongsToFirestore(
  songMetadata: Record<string, SongMeta>,
  masterSongs: any[],
) {
  const songs = buildUnifiedSongRecords(songMetadata, masterSongs);
  let batch = writeBatch(db);
  let count = 0;

  for (const song of songs) {
    batch.set(doc(db, 'songs', getSongDocId(song.title)), song);
    count += 1;

    if (count >= 400) {
      await batch.commit();
      batch = writeBatch(db);
      count = 0;
    }
  }

  if (count > 0) {
    await batch.commit();
  }
}

function buildUnifiedSongRecords(
  songMetadata: Record<string, SongMeta>,
  masterSongs: any[],
) {
  const songMap = new Map<string, any>();

  for (const song of masterSongs) {
    if (song?.title) {
      songMap.set(song.title, { ...song });
    }
  }

  for (const [title, metadata] of Object.entries(songMetadata)) {
    const existing = songMap.get(title) || { title };
    songMap.set(title, {
      ...existing,
      title,
      ...(metadata.lyrics !== undefined ? { lyrics: metadata.lyrics } : {}),
      ...(metadata.themes !== undefined ? { themes: metadata.themes } : {}),
      ...(metadata.parts !== undefined ? { parts: metadata.parts } : {}),
      ...(metadata.verse_order !== undefined
        ? { verse_order: metadata.verse_order }
        : {}),
      ...(metadata.embedding !== undefined
        ? { embedding: metadata.embedding }
        : {}),
    });
  }

  return Array.from(songMap.values());
}

async function syncLocalBackupCache(data: NormalizedBackupData) {
  await localforage.setItem('services', data.services);
  await localforage.setItem('songMetadata', data.songMetadata);
  await localforage.setItem(
    'masterSongs',
    data.masterSongs.length > 0
      ? data.masterSongs
      : buildUnifiedSongRecords(data.songMetadata, data.masterSongs),
  );
}
