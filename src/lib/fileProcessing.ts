import JSZip from 'jszip';
import { matchSong, extractDateFromFilename } from './songUtils';
import { SongMeta, ServiceData } from '../types';

export const processFile = async (file: File, masterSongsList: any[]): Promise<{ service: ServiceData, metadata: Record<string, SongMeta> } | null> => {
  try {
    if (file.size === 0) return null;

    const arrayBuffer = await file.arrayBuffer();
    if (arrayBuffer.byteLength === 0) return null;

    let jsonStr = '';
    try {
      const zip = new JSZip();
      const contents = await zip.loadAsync(arrayBuffer);
      
      const osjFiles = Object.keys(contents.files).filter(name => name.toLowerCase().endsWith('.osj'));
      if (osjFiles.length > 0) {
        const serviceDataFile = contents.file(osjFiles[0]);
        if (serviceDataFile) {
          jsonStr = await serviceDataFile.async('string');
        }
      }
    } catch (zipError) {
      // Not a zip file, try reading as text directly
      jsonStr = await file.text();
    }

    if (!jsonStr) {
      console.error(`Could not extract JSON from ${file.name}`);
      return null;
    }

    let data;
    try {
      data = JSON.parse(jsonStr);
    } catch (e) {
      console.error(`Failed to parse JSON in ${file.name}`, e);
      return null;
    }
    
    const songs: { title: string, lyrics: string }[] = [];
    
    const extractSongs = (items: any[]) => {
      items.forEach((item: any) => {
        const serviceItem = item?.serviceitem || item;
        const plugin = serviceItem?.header?.plugin || serviceItem?.plugin;
        const name = serviceItem?.header?.name || serviceItem?.name;
        
        if (plugin === 'songs' || name === 'songs') {
          const rawTitle = serviceItem?.header?.title || serviceItem?.title || serviceItem?.header?.name || 'Unknown Song';
          if (rawTitle.toLowerCase() !== 'blank') {
            let lyrics = '';
            if (serviceItem.data && Array.isArray(serviceItem.data)) {
               // Use raw_slide first to get full lyrics, fallback to title
               lyrics = serviceItem.data.map((d: any) => {
                 let slideText = d.raw_slide || d.title || '';
                 // Clean up OpenLP formatting tags like {st}, [---], etc.
                 slideText = slideText.replace(/\\{.*?\\}/g, '').replace(/\\[.*?\\]/g, '').trim();
                 return slideText;
               }).filter(Boolean).join('\\n\\n');
            }
            let title = matchSong(rawTitle, lyrics, masterSongsList);
            if (!title) title = rawTitle;
            songs.push({ title, lyrics });
          }
        }
      });
    };

    if (Array.isArray(data)) {
      extractSongs(data);
    } else if (data && Array.isArray(data.items)) {
      extractSongs(data.items);
    } else if (data && data.service && Array.isArray(data.service.items)) {
      extractSongs(data.service.items);
    } else if (typeof data === 'object') {
      for (const key in data) {
        if (Array.isArray(data[key])) {
          extractSongs(data[key]);
        }
      }
    }

    const serviceDate = extractDateFromFilename(file.name, new Date(file.lastModified));
    const isPM = file.name.toLowerCase().includes('pm');

    const uniqueSongs = Array.from(new Set(songs.map(s => s.title)));
    const metadata = songs.reduce((acc, s) => {
      if (s.lyrics && !acc[s.title]) {
        acc[s.title] = { lyrics: s.lyrics, themes: [] };
      }
      return acc;
    }, {} as Record<string, SongMeta>);

    return {
      service: {
        date: serviceDate,
        fileName: file.name,
        serviceType: isPM ? 'PM' : 'AM' as 'AM' | 'PM',
        songs: uniqueSongs
      },
      metadata
    };
  } catch (error) {
    return null;
  }
};
