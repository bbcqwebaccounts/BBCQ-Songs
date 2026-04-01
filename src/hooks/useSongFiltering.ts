import { useMemo } from 'react';
import { isValid, isSunday, previousSunday, nextSunday, isSameDay } from 'date-fns';
import { SongUsage, ServiceData } from '../types';

interface UseSongFilteringProps {
  allSongs: SongUsage[];
  themes: { theme: string; count: number }[];
  services: ServiceData[];
  searchTerm: string;
  themeSearchTerm: string;
  selectedTheme: string | null;
  sourceFilter: 'all' | 'TH' | 'BH' | 'others';
  includeLyricsInSearch: boolean;
  sortConfig: { key: string; direction: 'asc' | 'desc' };
  lookupDate: string;
  topChartHeight: number;
}

export function useSongFiltering({
  allSongs,
  themes,
  services,
  searchTerm,
  themeSearchTerm,
  selectedTheme,
  sourceFilter,
  includeLyricsInSearch,
  sortConfig,
  lookupDate,
  topChartHeight
}: UseSongFilteringProps) {
  const numTopSongs = Math.max(5, Math.floor((topChartHeight - 60) / 30));
  
  const dynamicTopSongs = useMemo(() => {
    return [...allSongs]
      .sort((a, b) => b.count - a.count || b.lastUsed.getTime() - a.lastUsed.getTime())
      .slice(0, numTopSongs);
  }, [allSongs, numTopSongs]);

  const filteredThemes = useMemo(() => {
    if (!themes) return [];
    if (!themeSearchTerm) return themes;
    const lowerSearch = themeSearchTerm.toLowerCase();
    return themes.filter(t => t.theme.toLowerCase().includes(lowerSearch));
  }, [themes, themeSearchTerm]);

  const sortedAndFilteredSongs = useMemo(() => {
    let result = [...allSongs];
    if (selectedTheme) {
      result = result.filter(s => s.themes?.includes(selectedTheme));
    }
    if (sourceFilter === 'TH') {
      result = result.filter(s => /^TH\d+:/i.test(s.title));
    } else if (sourceFilter === 'BH') {
      result = result.filter(s => /^BH\d+:/i.test(s.title));
    } else if (sourceFilter === 'others') {
      result = result.filter(s => !/^TH\d+:/i.test(s.title) && !/^BH\d+:/i.test(s.title));
    }
    if (searchTerm) {
      const lower = searchTerm.toLowerCase();
      result = result.filter(s => {
        if (s.title.toLowerCase().includes(lower)) return true;
        if (includeLyricsInSearch && s.lyrics && s.lyrics.toLowerCase().includes(lower)) return true;
        return false;
      });
    }
    
    result.sort((a, b) => {
      if (sortConfig.key === 'title') {
        return sortConfig.direction === 'asc' ? a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' }) : b.title.localeCompare(a.title, undefined, { numeric: true, sensitivity: 'base' });
      }
      if (sortConfig.key === 'count') {
        return sortConfig.direction === 'asc' ? a.count - b.count : b.count - a.count;
      }
      if (sortConfig.key === 'lastUsed') {
        return sortConfig.direction === 'asc' ? a.lastUsed.getTime() - b.lastUsed.getTime() : b.lastUsed.getTime() - a.lastUsed.getTime();
      }
      if (sortConfig.key === 'status') {
        const getStatusVal = (song: SongUsage) => {
          if (song.count === 0) return 0;
          const days = Math.floor((new Date().getTime() - song.lastUsed.getTime()) / (1000 * 3600 * 24));
          if (days < 30) return 3;
          if (days > 180) return 1;
          return 2;
        };
        return sortConfig.direction === 'asc' ? getStatusVal(a) - getStatusVal(b) : getStatusVal(b) - getStatusVal(a);
      }
      return 0;
    });
    
    return result;
  }, [searchTerm, allSongs, sortConfig, selectedTheme, sourceFilter, includeLyricsInSearch]);

  const topThemes = useMemo(() => {
    return [...themes].sort((a, b) => b.count - a.count).slice(0, 10);
  }, [themes]);

  const lookupResults = useMemo(() => {
    if (!lookupDate || services.length === 0) return null;
    
    const targetDate = new Date(lookupDate);
    if (!isValid(targetDate)) return null;

    let nearestSunday = targetDate;
    if (!isSunday(targetDate)) {
      const prev = previousSunday(targetDate);
      const next = nextSunday(targetDate);
      nearestSunday = Math.abs(targetDate.getTime() - prev.getTime()) < Math.abs(targetDate.getTime() - next.getTime()) ? prev : next;
    }

    const matchedServices = services.filter(s => isSameDay(s.date, nearestSunday));
    const amService = matchedServices.find(s => s.serviceType === 'AM');
    const pmService = matchedServices.find(s => s.serviceType === 'PM');

    return {
      date: nearestSunday,
      am: amService?.songs || [],
      pm: pmService?.songs || []
    };
  }, [lookupDate, services]);

  return {
    dynamicTopSongs,
    filteredThemes,
    sortedAndFilteredSongs,
    topThemes,
    lookupResults
  };
}
