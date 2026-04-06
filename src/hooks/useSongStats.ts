import { useMemo } from 'react';
import { format, eachMonthOfInterval, startOfMonth, endOfMonth, isSameMonth, eachWeekOfInterval, startOfWeek, endOfWeek, isSameWeek, eachYearOfInterval, startOfYear, endOfYear, isSameYear } from 'date-fns';
import { ServiceData, SongMeta, SongUsage } from '../types';
import { getServiceIdentityKey } from '../lib/firebaseData';
import { extractDateFromFilename } from '../lib/songUtils';

interface UseSongStatsProps {
  services: ServiceData[];
  masterSongs: any[];
  songMetadata: Record<string, SongMeta>;
  selectedSongsForChart: string[];
  timeScale: 'weekly' | 'monthly' | 'yearly';
}

export function useSongStats({
  services,
  masterSongs,
  songMetadata,
  selectedSongsForChart,
  timeScale
}: UseSongStatsProps) {
  return useMemo(() => {
    const songMap = new Map<string, SongUsage>();
    const uniqueServiceKeys = new Set<string>();
    const seenSongUsageKeys = new Set<string>();
    let earliestDate = new Date();
    let latestDate = new Date(0);
    
    // First, initialize songMap with all master songs
    masterSongs.forEach(masterSong => {
      songMap.set(masterSong.title, {
        title: masterSong.title,
        count: 0,
        amCount: 0,
        pmCount: 0,
        lastUsed: new Date(0),
        firstUsed: new Date(),
        datesUsed: [],
        lyrics: masterSong.lyrics || songMetadata[masterSong.title]?.lyrics,
        themes: songMetadata[masterSong.title]?.themes || [],
        parts: masterSong.parts || songMetadata[masterSong.title]?.parts,
        verse_order: masterSong.verse_order || songMetadata[masterSong.title]?.verse_order,
        embedding: songMetadata[masterSong.title]?.embedding,
        embeddingProvider: songMetadata[masterSong.title]?.embeddingProvider
      });
    });

    services.forEach(service => {
      const canonicalDate = extractDateFromFilename(service.fileName, service.date);

      uniqueServiceKeys.add(getServiceIdentityKey(canonicalDate, service.serviceType));
      if (canonicalDate < earliestDate) earliestDate = canonicalDate;
      if (canonicalDate > latestDate) latestDate = canonicalDate;

      service.songs.forEach(songTitle => {
        const usageKey = `${songTitle}::${getServiceIdentityKey(canonicalDate, service.serviceType)}`;
        if (seenSongUsageKeys.has(usageKey)) {
          return;
        }
        seenSongUsageKeys.add(usageKey);

        const existing = songMap.get(songTitle);
        if (existing) {
          existing.count += 1;
          if (service.serviceType === 'AM') existing.amCount += 1;
          if (service.serviceType === 'PM') existing.pmCount += 1;
          existing.datesUsed.push({ date: canonicalDate, type: service.serviceType });
          if (existing.lastUsed.getTime() === 0 || canonicalDate > existing.lastUsed) existing.lastUsed = canonicalDate;
          if (existing.firstUsed > new Date() || canonicalDate < existing.firstUsed) existing.firstUsed = canonicalDate;
        } else {
          songMap.set(songTitle, {
            title: songTitle,
            count: 1,
            amCount: service.serviceType === 'AM' ? 1 : 0,
            pmCount: service.serviceType === 'PM' ? 1 : 0,
            lastUsed: canonicalDate,
            firstUsed: canonicalDate,
            datesUsed: [{ date: canonicalDate, type: service.serviceType }],
            lyrics: songMetadata[songTitle]?.lyrics,
            themes: songMetadata[songTitle]?.themes,
            parts: songMetadata[songTitle]?.parts,
            verse_order: songMetadata[songTitle]?.verse_order,
            embedding: songMetadata[songTitle]?.embedding,
            embeddingProvider: songMetadata[songTitle]?.embeddingProvider
          });
        }
      });
    });

    const allSongs = Array.from(songMap.values());
    allSongs.forEach(song => song.datesUsed.sort((a, b) => b.date.getTime() - a.date.getTime()));

    const themeCounts = new Map<string, number>();
    allSongs.forEach(song => {
      if (song.themes) {
        song.themes.forEach(theme => {
          themeCounts.set(theme, (themeCounts.get(theme) || 0) + 1);
        });
      }
    });
    const themes = Array.from(themeCounts.entries())
      .map(([theme, count]) => ({ theme, count }))
      .sort((a, b) => b.count - a.count);

    let timeline: any[] = [];
    if (services.length > 0 && selectedSongsForChart.length > 0) {
      let intervals;
      if (timeScale === 'weekly') {
        intervals = eachWeekOfInterval({ start: startOfWeek(earliestDate), end: endOfWeek(latestDate) });
      } else if (timeScale === 'yearly') {
        intervals = eachYearOfInterval({ start: startOfYear(earliestDate), end: endOfYear(latestDate) });
      } else {
        intervals = eachMonthOfInterval({ start: startOfMonth(earliestDate), end: endOfMonth(latestDate) });
      }

      timeline = intervals.map(intervalDate => {
        let dateLabel = '';
        if (timeScale === 'weekly') dateLabel = format(intervalDate, 'MMM d, yyyy');
        else if (timeScale === 'yearly') dateLabel = format(intervalDate, 'yyyy');
        else dateLabel = format(intervalDate, 'MMM yyyy');

        const dataPoint: any = { date: dateLabel, timestamp: intervalDate.getTime() };
        
        selectedSongsForChart.forEach(songTitle => {
          const song = songMap.get(songTitle);
          if (!song) {
            dataPoint[songTitle] = 0;
            return;
          }
          const playsInInterval = song.datesUsed.filter(d => {
            if (timeScale === 'weekly') return isSameWeek(d.date, intervalDate);
            if (timeScale === 'yearly') return isSameYear(d.date, intervalDate);
            return isSameMonth(d.date, intervalDate);
          }).length;
          dataPoint[songTitle] = playsInInterval;
        });
        return dataPoint;
      });
    }

    return {
      totalServices: uniqueServiceKeys.size,
      totalUniqueSongs: allSongs.length,
      allSongs,
      timeline,
      themes
    };
  }, [services, songMetadata, masterSongs, selectedSongsForChart, timeScale]);
}
