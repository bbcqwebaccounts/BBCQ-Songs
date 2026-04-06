import localforage from 'localforage';
import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  updateDoc,
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
export const getServiceIdentityKey = (
  date: Date | string,
  serviceType: string,
) => {
  const normalizedDate =
    date instanceof Date
      ? date.toISOString().split('T')[0]
      : new Date(date).toISOString().split('T')[0];
  return `${normalizedDate}-${serviceType}`;
};

function deepStripNil(value: any): any {
  if (Array.isArray(value)) {
    return value
      .filter((item) => item !== undefined && item !== null)
      .map((item) => deepStripNil(item));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entryValue]) => entryValue !== undefined && entryValue !== null)
        .map(([key, entryValue]) => [key, deepStripNil(entryValue)]),
    );
  }

  return value;
}

export function sanitizeSongForFirestore(song: Record<string, any>) {
  const cleaned: Record<string, any> = {
    title: song.title,
  };

  const stringFields = [
    'alternate_title',
    'lyrics',
    'author',
    'verse_order',
    'copyright',
  ];

  for (const field of stringFields) {
    if (typeof song[field] === 'string' && song[field].trim().length > 0) {
      cleaned[field] = song[field];
    }
  }

  if (song.ccli_number !== undefined && song.ccli_number !== null && String(song.ccli_number).trim()) {
    cleaned.ccli_number = String(song.ccli_number);
  }

  if (Array.isArray(song.themes) && song.themes.length > 0) {
    cleaned.themes = song.themes.filter((theme) => typeof theme === 'string' && theme.trim().length > 0);
  }

  if (Array.isArray(song.parts) && song.parts.length > 0) {
    cleaned.parts = song.parts
      .map((part) =>
        deepStripNil({
          type: part?.type,
          label: part?.label,
          text: part?.text,
        }),
      )
      .filter(
        (part) =>
          typeof part.type === 'string' &&
          typeof part.label === 'string' &&
          typeof part.text === 'string',
      );
  }

  if (Array.isArray(song.embedding) && song.embedding.length > 0) {
    cleaned.embedding = song.embedding;
  }

  if (
    typeof song.embeddingProvider === 'string' &&
    song.embeddingProvider.trim().length > 0
  ) {
    cleaned.embeddingProvider = song.embeddingProvider;
  }

  return deepStripNil(cleaned);
}

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

export async function deduplicateServicesInFirebase() {
  const servicesSnapshot = await getDocs(collection(db, 'services'));
  const grouped = new Map<
    string,
    {
      keeperId: string;
      date: string;
      serviceType: 'AM' | 'PM';
      fileName: string;
      songs: Set<string>;
      duplicateIds: string[];
    }
  >();

  servicesSnapshot.forEach((serviceDoc) => {
    const data = serviceDoc.data();
    const serviceDate = typeof data.date === 'string'
      ? data.date
      : new Date(data.date).toISOString().split('T')[0];
    const serviceType = data.serviceType === 'PM' ? 'PM' : 'AM';
    const songs = Array.isArray(data.songs) ? data.songs : [];
    const key = getServiceIdentityKey(serviceDate, serviceType);

    if (!grouped.has(key)) {
      grouped.set(key, {
        keeperId: serviceDoc.id,
        date: serviceDate,
        serviceType,
        fileName: data.fileName || '',
        songs: new Set(songs),
        duplicateIds: [],
      });
      return;
    }

    const existing = grouped.get(key)!;
    songs.forEach((song: string) => existing.songs.add(song));
    if (!existing.fileName && data.fileName) {
      existing.fileName = data.fileName;
    }
    existing.duplicateIds.push(serviceDoc.id);
  });

  let mergedServices = 0;
  let removedServices = 0;
  let batch = writeBatch(db);
  let count = 0;

  const commitIfNeeded = async () => {
    if (count >= 400) {
      await batch.commit();
      batch = writeBatch(db);
      count = 0;
    }
  };

  for (const service of grouped.values()) {
    if (service.duplicateIds.length === 0) {
      continue;
    }

    batch.set(
      doc(db, 'services', service.keeperId),
      {
        date: service.date,
        fileName: service.fileName,
        serviceType: service.serviceType,
        songs: Array.from(service.songs),
      },
      { merge: true },
    );
    count += 1;
    mergedServices += 1;
    await commitIfNeeded();

    for (const duplicateId of service.duplicateIds) {
      batch.delete(doc(db, 'services', duplicateId));
      count += 1;
      removedServices += 1;
      await commitIfNeeded();
    }
  }

  if (count > 0) {
    await batch.commit();
  }

  return {
    mergedServices,
    removedServices,
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

export async function updateServiceDateInFirebase({
  serviceId,
  nextDate,
}: {
  serviceId: string;
  nextDate: string;
}) {
  const trimmedDate = nextDate.trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmedDate)) {
    throw new Error('Service date must be in YYYY-MM-DD format.');
  }

  await updateDoc(doc(db, 'services', serviceId), {
    date: trimmedDate,
  });

  return {
    date: new Date(trimmedDate),
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
    batch.set(doc(db, 'songs', getSongDocId(song.title)), sanitizeSongForFirestore(song));
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
