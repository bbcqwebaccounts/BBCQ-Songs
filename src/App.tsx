import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import JSZip from 'jszip';
import { format, parse, isValid, eachMonthOfInterval, startOfMonth, endOfMonth, isSameMonth, isSunday, previousSunday, nextSunday, isSameDay, eachWeekOfInterval, startOfWeek, endOfWeek, isSameWeek, eachYearOfInterval, startOfYear, endOfYear, isSameYear, subWeeks } from 'date-fns';
import { Upload, Calendar, Music, Search, BarChart3, TrendingUp, X, Info, ArrowUpDown, ChevronDown, ChevronUp, Save, Sparkles, Loader2, CheckCircle2, Settings, Cloud, CloudOff, RefreshCw, Database } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Legend, Brush } from 'recharts';
import initSqlJs from 'sql.js';
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import localforage from 'localforage';
import defaultData from './defaultData.json';

import { GoogleGenAI, Type } from '@google/genai';
import { SongMeta, SongUsage, ServiceData } from './types';
import { matchSong, formatLyricLabel, extractDateFromFilename, parseOpenLPLyrics } from './lib/songUtils';
import { processFile } from './lib/fileProcessing';
import { useFileHandler } from './hooks/useFileHandler';
import { UnifiedSettingsDialog } from './components/UnifiedSettingsDialog';
import { ConsolidateDialog } from './components/ConsolidateDialog';
import { SongDetailsDialog } from './components/SongDetailsDialog';
import { AIRecommendations } from './components/AIRecommendations';
import { useConsolidation } from './hooks/useConsolidation';
import { useSongStats } from './hooks/useSongStats';
import { useSongFiltering } from './hooks/useSongFiltering';
import { useDragAndDrop } from './hooks/useDragAndDrop';
import { useFirebaseData } from './hooks/useFirebaseData';
import { auth, signInWithGoogle, logOut } from './firebase';
import {
  deduplicateServicesInFirebase,
  deleteSongEverywhere,
  getFirebaseActionMessage,
  updateServiceDateInFirebase,
  updateSongDetailsInFirebase,
} from './lib/firebaseData';
import { toast } from 'sonner';

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4'];

import { useAIRecommendations } from './hooks/useAIRecommendations';

import { Toaster } from '@/components/ui/sonner';

export default function App() {
  const [services, setServices] = useState<ServiceData[]>([]);
  const [songMetadata, setSongMetadata] = useState<Record<string, SongMeta>>({});
  const [searchTerm, setSearchTerm] = useState('');
  const [themeSearchTerm, setThemeSearchTerm] = useState('');
  const [selectedTheme, setSelectedTheme] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<'all' | 'TH' | 'BH' | 'others'>('all');
  const [includeLyricsInSearch, setIncludeLyricsInSearch] = useState(true);
  const [processingFiles, setProcessingFiles] = useState(0);
  const [selectedSongsForChart, setSelectedSongsForChart] = useState<string[]>([]);
  const [viewingSong, setViewingSong] = useState<SongUsage | null>(null);
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' }>({ key: 'title', direction: 'asc' });
  const [lookupDate, setLookupDate] = useState<string>('');
  const [lookupPreset, setLookupPreset] = useState<'date' | 'last1' | 'last4' | 'last12'>('date');
  const [timeScale, setTimeScale] = useState<'weekly' | 'monthly' | 'yearly'>('yearly');
  const [masterSongs, setMasterSongs] = useState<any[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  const [activeSearch, setActiveSearch] = useState<string | null>(null);
  const [masterSearchTerm, setMasterSearchTerm] = useState('');
  const [pendingConsolidationCheck, setPendingConsolidationCheck] = useState(false);

  const [topChartHeight, setTopChartHeight] = useState(300);
  const topChartRef = useRef<HTMLDivElement>(null);
  const hasAutoSelected = useRef(false);

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [songSettingsSearch, setSongSettingsSearch] = useState('');
  const [syncStatus, setSyncStatus] = useState<string>('');
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);

  const { isAuthReady, userId, userEmail, isAdmin } = useFirebaseData({
    setServices,
    setSongMetadata,
    setMasterSongs,
    setIsLoaded,
    setSyncStatus,
    setLastSyncTime
  });

  useEffect(() => {
    if (!topChartRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (let entry of entries) {
        setTopChartHeight(entry.contentRect.height);
      }
    });
    observer.observe(topChartRef.current);
    return () => observer.disconnect();
  }, [services.length]);

  const { handleFiles } = useFileHandler({
    masterSongs,
    setMasterSongs,
    services,
    setServices,
    songMetadata,
    setProcessingFiles,
    setPendingConsolidationCheck
  });

  const { isDragging, onDragOver, onDragLeave, onDrop, onFileInput } = useDragAndDrop({ handleFiles });

  const {
    isConsolidateDialogOpen,
    setIsConsolidateDialogOpen,
    consolidationTasks,
    setConsolidationTasks,
    consolidationFilter,
    setConsolidationFilter,
    focusedSongTitle,
    setFocusedSongTitle,
    startConsolidation,
    applyConsolidation
  } = useConsolidation({
    masterSongs,
    services,
    songMetadata,
    setServices,
    setMasterSongs,
    pendingConsolidationCheck,
    setPendingConsolidationCheck
  });

  const exportData = () => {
    const dataStr = JSON.stringify({ services, songMetadata, masterSongs });
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    const exportFileDefaultName = `openlp-stats-backup-${format(new Date(), 'yyyy-MM-dd')}.json`;
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  };

  const clearData = async () => {
    if (!isAdmin) {
      toast.error('Admin access is required to clear all Firebase data.');
      return;
    }

    try {
      await localforage.clear();
      
      // Clear Firebase data
      const { collection, getDocs, writeBatch, doc } = await import('firebase/firestore');
      const { db } = await import('./firebase');
      
      const servicesSnapshot = await getDocs(collection(db, 'services'));
      const songsSnapshot = await getDocs(collection(db, 'songs'));
      
      let batch = writeBatch(db);
      let count = 0;
      
      for (const document of servicesSnapshot.docs) {
        batch.delete(doc(db, 'services', document.id));
        count++;
        if (count === 400) {
          await batch.commit();
          batch = writeBatch(db);
          count = 0;
        }
      }
      
      for (const document of songsSnapshot.docs) {
        batch.delete(doc(db, 'songs', document.id));
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
      setServices([]);
      setSongMetadata({});
      setMasterSongs([]);
      setSelectedSongsForChart([]);
      setLookupDate('');
      hasAutoSelected.current = false;
      toast.success("All data has been cleared.");
    } catch (e) {
      console.error('Failed to clear Firebase data.', e);
      toast.error(getFirebaseActionMessage(e, 'Failed to clear Firebase data.'));
    }
  };

  const handleDeduplicateServices = async () => {
    if (!isAdmin) {
      toast.error('Admin access is required to deduplicate services.');
      return;
    }

    try {
      const result = await deduplicateServicesInFirebase();
      if (result.removedServices === 0) {
        toast.success('No duplicate services were found.');
        return;
      }

      toast.success(
        `Merged ${result.mergedServices} duplicated service groups and removed ${result.removedServices} duplicate entries.`,
      );
    } catch (error) {
      console.error('Failed to deduplicate services.', error);
      toast.error(getFirebaseActionMessage(error, 'Failed to deduplicate services.'));
    }
  };

  const handleUpdateServiceDate = async (serviceId: string, nextDate: string) => {
    if (!isAdmin) {
      throw new Error('Admin access is required to edit service dates.');
    }

    try {
      const result = await updateServiceDateInFirebase({ serviceId, nextDate });

      setServices((current) =>
        current.map((service) =>
          service.id === serviceId
            ? {
                ...service,
                date: result.date,
              }
            : service,
        ),
      );
    } catch (error) {
      throw new Error(getFirebaseActionMessage(error, 'Failed to update service date.'));
    }
  };

  const stats = useSongStats({
    services,
    masterSongs,
    songMetadata,
    selectedSongsForChart,
    timeScale
  });

  const {
    aiPrompt,
    setAiPrompt,
    isAiLoading,
    aiRecommendations,
    setAiRecommendations,
    processingEmbeddings,
    embeddingProgress,
    generatingThemes,
    themeProgress,
    getAiRecommendations,
    handleProcessEmbeddings,
    handleGenerateMissingThemes
  } = useAIRecommendations(stats.allSongs);

  const {
    dynamicTopSongs,
    filteredThemes,
    sortedAndFilteredSongs,
    topThemes,
    lookupResults
  } = useSongFiltering({
    allSongs: stats.allSongs,
    themes: stats.themes,
    services,
    searchTerm,
    themeSearchTerm,
    selectedTheme,
    sourceFilter,
    includeLyricsInSearch,
    sortConfig,
    lookupDate,
    lookupPreset,
    topChartHeight
  });

  useEffect(() => {
    if (services.length > 0 && selectedSongsForChart.length === 0 && !hasAutoSelected.current) {
      const top3 = [...stats.allSongs].sort((a, b) => b.count - a.count).slice(0, 3).map(s => s.title);
      setSelectedSongsForChart(top3);
      hasAutoSelected.current = true;
    }
  }, [services.length, stats.allSongs, selectedSongsForChart.length]);

  const toggleSongSelection = (title: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedSongsForChart(prev => {
      if (prev.includes(title)) return prev.filter(t => t !== title);
      if (prev.length >= 5) {
        const newSelection = [...prev];
        newSelection.shift();
        newSelection.push(title);
        return newSelection;
      }
      return [...prev, title];
    });
  };

  const updateSongThemes = async (title: string, themes: string[]) => {
    try {
      const { doc, updateDoc } = await import('firebase/firestore');
      const { db } = await import('./firebase');
      const safeId = title.replace(/\//g, '_');
      await updateDoc(doc(db, 'songs', safeId), { themes });
    } catch (error) {
      const { handleFirestoreError, OperationType } = await import('./firebase');
      handleFirestoreError(error, OperationType.UPDATE, 'songs');
    }
  };

  const handleDeleteSong = async (title: string) => {
    if (!isAdmin) {
      toast.error('Admin access is required to delete songs.');
      return;
    }

    try {
      await deleteSongEverywhere(title);
      setSelectedSongsForChart((prev) => prev.filter((songTitle) => songTitle !== title));
      if (viewingSong?.title === title) {
        setViewingSong(null);
      }
      toast.success(`Deleted "${title}" and removed it from service history.`);
    } catch (error) {
      console.error('Failed to delete song.', error);
      toast.error(getFirebaseActionMessage(error, 'Failed to delete song.'));
    }
  };

  const handleSaveSong = async (
    currentTitle: string,
    updates: { title: string; lyrics: string },
  ) => {
    const nextTitle = updates.title.trim();

    if (!nextTitle) {
      toast.error('Song title is required.');
      return null;
    }

    if (!isAdmin && nextTitle !== currentTitle) {
      toast.error('Admin access is required to rename songs.');
      return null;
    }

    const existingSong =
      masterSongs.find((song) => song.title === currentTitle) || {
        title: currentTitle,
        ...songMetadata[currentTitle],
      };

    try {
      const lyricsChanged = updates.lyrics !== (existingSong.lyrics || '');
      const result = await updateSongDetailsInFirebase({
        currentTitle,
        nextTitle,
        lyrics: updates.lyrics,
        existingSong,
      });

      if (currentTitle !== result.title) {
        setSelectedSongsForChart((prev) =>
          prev.map((songTitle) => (songTitle === currentTitle ? result.title : songTitle)),
        );
      }

      setViewingSong((prev) =>
        prev
          ? {
              ...prev,
              title: result.title,
              lyrics: result.lyrics,
              parts: lyricsChanged ? undefined : prev.parts,
              verse_order: lyricsChanged ? undefined : prev.verse_order,
            }
          : prev,
      );

      toast.success(`Saved changes to "${result.title}".`);
      return result;
    } catch (error) {
      console.error('Failed to save song.', error);
      toast.error(getFirebaseActionMessage(error, 'Failed to save song.'));
      return null;
    }
  };

  const handleSort = (key: string) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc'
    }));
  };

  const SortIcon = ({ columnKey }: { columnKey: string }) => {
    if (sortConfig.key !== columnKey) return <ArrowUpDown className="h-4 w-4 ml-1 text-slate-400 inline" />;
    return sortConfig.direction === 'asc' ? <ChevronUp className="h-4 w-4 ml-1 text-indigo-600 inline" /> : <ChevronDown className="h-4 w-4 ml-1 text-indigo-600 inline" />;
  };

  const latestServiceDate = useMemo(() => {
    if (services.length === 0) return null;
    return services.reduce((latest, service) => {
      const serviceDate = extractDateFromFilename(service.fileName, service.date);
      return serviceDate > latest ? serviceDate : latest;
    }, extractDateFromFilename(services[0].fileName, services[0].date));
  }, [services]);

  const handleLookupPreset = (preset: 'last1' | 'last4' | 'last12') => {
    setLookupPreset(preset);
    if (!latestServiceDate) return;

    const weeks = preset === 'last1' ? 1 : preset === 'last4' ? 4 : 12;
    const targetDate = subWeeks(latestServiceDate, weeks - 1);
    setLookupDate(format(targetDate, 'yyyy-MM-dd'));
  };

  if (!isAuthReady) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 text-indigo-600 animate-spin" />
          <p className="text-slate-600 font-medium">Loading application...</p>
        </div>
      </div>
    );
  }



  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 p-4 md:p-8 font-sans">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
              <Music className="h-8 w-8 text-indigo-600" />
              BBCQ Songs
              {masterSongs.length > 0 && (
                <Badge variant="outline" className="ml-2 bg-green-50 text-green-700 border-green-200">
                  DB Loaded ({masterSongs.length} songs)
                </Badge>
              )}
            </h1>
            <div className="flex items-center gap-2 mt-1">
              <p className="text-slate-500">Analyze song usage across your church services</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {syncStatus && (
              <div className="flex items-center text-sm text-blue-600 bg-blue-50 px-3 py-1.5 rounded-md">
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                {syncStatus}
              </div>
            )}
            <Button variant="outline" onClick={() => setIsSettingsOpen(true)} className="text-slate-600 hover:text-slate-900">
              <Settings className="h-4 w-4 mr-2" />
              Settings
            </Button>
            {userId ? (
              <Button variant="ghost" onClick={logOut} className="text-slate-600 hover:text-red-600">
                Sign Out
              </Button>
            ) : (
              <Button variant="ghost" onClick={signInWithGoogle} className="text-slate-600 hover:text-indigo-600">
                Sign In
              </Button>
            )}
          </div>
        </div>

        {/* Upload Area */}
        {services.length === 0 && masterSongs.length === 0 ? (
          <Card 
            className={`border-2 border-dashed transition-colors ${isDragging ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300 bg-white'}`}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
          >
            <CardContent className="flex flex-col items-center justify-center py-24 text-center">
              <div className="h-20 w-20 rounded-full bg-indigo-100 flex items-center justify-center mb-6">
                <Upload className="h-10 w-10 text-indigo-600" />
              </div>
              <h3 className="text-xl font-semibold mb-2">Upload OpenLP Files, Backup, or SQLite DB</h3>
              <p className="text-slate-500 max-w-md mb-8">
                Drag and drop your .osz files, a .json backup, or a clean .sqlite database here. We'll extract the songs and build your dashboard.
              </p>
              <div className="relative">
                <Input 
                  type="file" 
                  multiple 
                  accept=".osz,.zip,.json,.sqlite,.db" 
                  onChange={onFileInput}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <Button size="lg" className="bg-indigo-600 hover:bg-indigo-700">
                  Select Files
                </Button>
              </div>
              {processingFiles > 0 && (
                <p className="mt-4 text-sm text-indigo-600 font-medium animate-pulse">
                  Processing {processingFiles} files...
                </p>
              )}
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Quick Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-slate-500">Total Services</CardTitle>
                  <Calendar className="h-4 w-4 text-slate-400" />
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">{stats.totalServices}</div>
                  <p className="text-xs text-slate-500 mt-1">
                    {services.filter(s => s.serviceType === 'AM').length} AM / {services.filter(s => s.serviceType === 'PM').length} PM
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-slate-500">Unique Songs</CardTitle>
                  <Music className="h-4 w-4 text-slate-400" />
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">{stats.totalUniqueSongs}</div>
                </CardContent>
              </Card>
              <Card className="bg-indigo-50 border-indigo-100">
                <CardContent className="flex flex-col items-center justify-center h-full py-6">
                  <div className="relative w-full">
                    <Input 
                      type="file" 
                      multiple 
                      accept=".osz,.zip,.json,.sqlite,.db" 
                      onChange={onFileInput}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                    <Button variant="outline" className="w-full bg-white border-indigo-200 text-indigo-700 hover:bg-indigo-100">
                      <Upload className="h-4 w-4 mr-2" />
                      Add More Files
                    </Button>
                  </div>
                  {processingFiles > 0 && (
                    <p className="mt-2 text-xs text-indigo-600 font-medium animate-pulse">
                      Processing {processingFiles} files...
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* AI Recommend Section */}
            <AIRecommendations
              aiPrompt={aiPrompt}
              setAiPrompt={setAiPrompt}
              getAiRecommendations={getAiRecommendations}
              isAiLoading={isAiLoading}
              aiRecommendations={aiRecommendations}
              setAiRecommendations={setAiRecommendations}
              allSongs={stats.allSongs}
              songMetadata={songMetadata}
              setViewingSong={setViewingSong}
            />

            {/* Service Lookup */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Search className="h-5 w-5 text-indigo-500" />
                  Service Lookup
                </CardTitle>
                <CardDescription>Find songs played on a specific date (snaps to nearest Sunday)</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col md:flex-row gap-6">
                  <div className="w-full md:w-1/3">
                    <Input
                      type="date"
                      value={lookupDate}
                      onChange={(e) => {
                        setLookupPreset('date');
                        setLookupDate(e.target.value);
                      }}
                    />
                    <div className="flex flex-wrap gap-2 mt-3">
                      <Button
                        type="button"
                        variant={lookupPreset === 'last1' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => handleLookupPreset('last1')}
                      >
                        Last Week
                      </Button>
                      <Button
                        type="button"
                        variant={lookupPreset === 'last4' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => handleLookupPreset('last4')}
                      >
                        Last 4 Weeks
                      </Button>
                      <Button
                        type="button"
                        variant={lookupPreset === 'last12' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => handleLookupPreset('last12')}
                      >
                        Last 12 Weeks
                      </Button>
                    </div>
                    {lookupResults && (
                      <p className="text-sm text-slate-500 mt-2">
                        Showing services for {lookupResults.label}
                      </p>
                    )}
                  </div>
                  <div className="w-full md:w-2/3 grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="border rounded-lg p-4 bg-slate-50">
                      <h4 className="font-semibold text-slate-700 mb-2 flex items-center justify-between">
                        AM Service
                        <Badge variant="outline">{lookupResults?.am.length || 0} songs</Badge>
                      </h4>
                      {lookupResults?.am.length ? (
                        <ul className="space-y-1 text-sm">
                          {lookupResults.am.map(song => <li key={song}>• {song}</li>)}
                        </ul>
                      ) : (
                        <p className="text-sm text-slate-400 italic">No AM service found for this date.</p>
                      )}
                    </div>
                    <div className="border rounded-lg p-4 bg-slate-50">
                      <h4 className="font-semibold text-slate-700 mb-2 flex items-center justify-between">
                        PM Service
                        <Badge variant="outline">{lookupResults?.pm.length || 0} songs</Badge>
                      </h4>
                      {lookupResults?.pm.length ? (
                        <ul className="space-y-1 text-sm">
                          {lookupResults.pm.map(song => <li key={song}>• {song}</li>)}
                        </ul>
                      ) : (
                        <p className="text-sm text-slate-400 italic">No PM service found for this date.</p>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="flex flex-col">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BarChart3 className="h-5 w-5 text-indigo-500" />
                    Top Most Used Songs
                  </CardTitle>
                  <CardDescription>Drag the bottom edge of this chart to expand and see more songs.</CardDescription>
                </CardHeader>
                <CardContent className="p-0 flex-1">
                  <div 
                    ref={topChartRef}
                    className="w-full overflow-auto resize-y min-h-[300px] max-h-[800px] p-6 pt-0"
                    style={{ height: '300px' }}
                  >
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={dynamicTopSongs} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} />
                        <XAxis type="number" />
                        <YAxis 
                          dataKey="title" 
                          type="category" 
                          width={200} 
                          tick={{ fontSize: 12 }} 
                          tickFormatter={(value) => value.length > 30 ? `${value.substring(0, 27)}...` : value}
                        />
                        <Tooltip 
                          cursor={{ fill: '#f1f5f9' }}
                          contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                        />
                        <Bar dataKey="count" fill="#6366f1" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <TrendingUp className="h-5 w-5 text-emerald-500" />
                      Selected Songs Usage
                    </CardTitle>
                    <CardDescription>Use the brush at the bottom to zoom and pan.</CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex bg-slate-100 p-1 rounded-md">
                      <button 
                        onClick={() => setTimeScale('weekly')}
                        className={`px-3 py-1 text-xs font-medium rounded-sm transition-colors ${timeScale === 'weekly' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
                      >
                        Weekly
                      </button>
                      <button 
                        onClick={() => setTimeScale('monthly')}
                        className={`px-3 py-1 text-xs font-medium rounded-sm transition-colors ${timeScale === 'monthly' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
                      >
                        Monthly
                      </button>
                      <button 
                        onClick={() => setTimeScale('yearly')}
                        className={`px-3 py-1 text-xs font-medium rounded-sm transition-colors ${timeScale === 'yearly' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
                      >
                        Yearly
                      </button>
                    </div>
                    {selectedSongsForChart.length > 0 && (
                      <Button variant="ghost" size="sm" onClick={() => setSelectedSongsForChart([])} className="h-8 text-xs text-slate-500 hover:text-slate-900">
                        Deselect All
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="h-[300px]">
                  {selectedSongsForChart.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-slate-400">
                      Select songs from the list below to compare their usage.
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={stats.timeline} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                        <YAxis allowDecimals={false} />
                        <Tooltip 
                          contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                        />
                        <Legend 
                          verticalAlign="top" 
                          height={36} 
                          formatter={(value) => value.length > 30 ? `${value.substring(0, 27)}...` : value}
                        />
                        {selectedSongsForChart.map((songTitle, index) => (
                          <Bar 
                            key={songTitle}
                            dataKey={songTitle} 
                            fill={COLORS[index % COLORS.length]} 
                            radius={[4, 4, 0, 0]}
                            maxBarSize={40}
                          />
                        ))}
                        <Brush dataKey="date" height={30} stroke="#6366f1" />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Themes Section */}
            {stats.themes && stats.themes.length > 0 && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <Card className="lg:col-span-2 flex flex-col">
                  <CardHeader>
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                      <div>
                        <CardTitle className="flex items-center gap-2">
                          <TrendingUp className="h-5 w-5 text-indigo-500" />
                          Song Themes
                        </CardTitle>
                        <CardDescription>AI-generated themes across all imported songs. Click a theme to filter the song list.</CardDescription>
                      </div>
                      <div className="relative w-full sm:w-64">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                        <Input
                          type="search"
                          placeholder="Search themes..."
                          className="pl-9"
                          value={themeSearchTerm}
                          onChange={(e) => setThemeSearchTerm(e.target.value)}
                        />
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="flex-1 overflow-hidden">
                    <ScrollArea className="h-[250px] w-full pr-4">
                      <div className="flex flex-wrap gap-2">
                        {filteredThemes.map(t => (
                          <Badge 
                            key={t.theme} 
                            variant={selectedTheme === t.theme ? "default" : "secondary"} 
                            className={`cursor-pointer ${selectedTheme === t.theme ? 'bg-indigo-600 hover:bg-indigo-700' : 'hover:bg-slate-200'}`}
                            onClick={() => setSelectedTheme(selectedTheme === t.theme ? null : t.theme)}
                          >
                            {t.theme} ({t.count})
                          </Badge>
                        ))}
                        {filteredThemes.length === 0 && (
                          <div className="text-sm text-slate-500 py-4">No themes found matching "{themeSearchTerm}"</div>
                        )}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>
                
                <Card className="lg:col-span-1">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <BarChart3 className="h-5 w-5 text-indigo-500" />
                      Top 10 Themes
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="h-[300px] p-0 pb-4">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={topThemes} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} />
                        <XAxis type="number" hide />
                        <YAxis dataKey="theme" type="category" width={80} tick={{ fontSize: 11 }} />
                        <Tooltip 
                          cursor={{ fill: '#f1f5f9' }}
                          contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                        />
                        <Bar dataKey="count" fill="#8b5cf6" radius={[0, 4, 4, 0]} maxBarSize={20} />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Song List */}
            <Card>
              <CardHeader>
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  <div>
                    <CardTitle>All Songs</CardTitle>
                    <CardDescription>Click a column header to sort. Click a song for details.</CardDescription>
                  </div>
                  <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 w-full sm:w-auto">
                    <div className="flex w-full sm:w-auto items-center gap-2">
                      <Button 
                        variant="outline" 
                        className="w-full sm:w-auto border-slate-200 text-slate-700 hover:bg-slate-50"
                        onClick={() => {
                          if (!isAdmin) {
                            toast.error('Admin access is required to consolidate songs.');
                            return;
                          }
                          startConsolidation();
                        }}
                        disabled={masterSongs.length === 0}
                      >
                        Consolidate
                      </Button>
                      {selectedSongsForChart.length > 0 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedSongsForChart([])}
                          className="h-9 whitespace-nowrap text-slate-500 hover:text-slate-900"
                        >
                          Deselect All
                        </Button>
                      )}
                    </div>
                    <div className="relative w-full sm:w-72 flex flex-col gap-2">
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                          <Input
                            type="search"
                            placeholder="Search songs..."
                            className="pl-9 pr-8"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                          />
                          {(searchTerm || selectedTheme || sourceFilter !== 'all') && (
                            <button 
                              onClick={() => {
                                setSearchTerm('');
                                setSelectedTheme(null);
                                setSourceFilter('all');
                              }}
                              className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
                              title="Clear filters"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                        <Select value={sourceFilter} onValueChange={(val: any) => setSourceFilter(val)}>
                          <SelectTrigger className="w-[110px]">
                            <SelectValue placeholder="Source" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All Sources</SelectItem>
                            <SelectItem value="TH">TH Only</SelectItem>
                            <SelectItem value="BH">BH Only</SelectItem>
                            <SelectItem value="others">Others</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex items-center gap-2 px-1">
                        <Checkbox 
                          id="include-lyrics" 
                          checked={includeLyricsInSearch} 
                          onCheckedChange={(c) => setIncludeLyricsInSearch(!!c)} 
                        />
                        <label htmlFor="include-lyrics" className="text-sm text-slate-600 cursor-pointer">Include lyrics in search</label>
                      </div>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="rounded-md border">
                  <Table className="w-full">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-center">Chart</TableHead>
                        <TableHead className="w-1/2 cursor-pointer hover:bg-slate-50" onClick={() => handleSort('title')}>
                          Song Title <SortIcon columnKey="title" />
                        </TableHead>
                        <TableHead className="cursor-pointer hover:bg-slate-50" onClick={() => handleSort('count')}>
                          Times Used <SortIcon columnKey="count" />
                        </TableHead>
                        <TableHead className="cursor-pointer hover:bg-slate-50" onClick={() => handleSort('lastUsed')}>
                          Last Used <SortIcon columnKey="lastUsed" />
                        </TableHead>
                        <TableHead className="text-right cursor-pointer hover:bg-slate-50" onClick={() => handleSort('status')}>
                          Status <SortIcon columnKey="status" />
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortedAndFilteredSongs.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5} className="h-24 text-center text-slate-500">
                            No songs found.
                          </TableCell>
                        </TableRow>
                      ) : (
                        sortedAndFilteredSongs.map((song) => {
                          const daysSinceLastUsed = Math.floor((new Date().getTime() - song.lastUsed.getTime()) / (1000 * 3600 * 24));
                          const isSelected = selectedSongsForChart.includes(song.title);
                          
                          return (
                            <TableRow 
                              key={song.title} 
                              className="cursor-pointer hover:bg-slate-50"
                              onClick={() => setViewingSong(song)}
                            >
                              <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                                <Checkbox 
                                  checked={isSelected}
                                  onCheckedChange={() => toggleSongSelection(song.title, { stopPropagation: () => {} } as any)}
                                  aria-label={`Select ${song.title} for chart`}
                                />
                              </TableCell>
                              <TableCell className="font-medium truncate max-w-xs" title={song.title}>{song.title}</TableCell>
                              <TableCell>
                                <Badge variant="secondary" className="font-mono">
                                  {song.count}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                {song.count === 0 ? (
                                  <span className="text-slate-400 italic">Never</span>
                                ) : (
                                  <>
                                    {format(song.lastUsed, 'MMM d, yyyy')}
                                    <span className="ml-2 text-xs text-slate-500">
                                      {song.datesUsed[0]?.type || ''}
                                    </span>
                                  </>
                                )}
                              </TableCell>
                              <TableCell className="text-right">
                                {song.count === 0 ? (
                                  <Badge className="bg-slate-100 text-slate-800 hover:bg-slate-100 border-slate-200">Never Played</Badge>
                                ) : daysSinceLastUsed < 30 ? (
                                  <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 border-emerald-200">Recent</Badge>
                                ) : daysSinceLastUsed > 180 ? (
                                  <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 border-amber-200">Hasn't been played in 6mo</Badge>
                                ) : (
                                  <Badge className="bg-slate-100 text-slate-800 hover:bg-slate-100 border-slate-200">Active</Badge>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </>
        )}

        {/* Consolidate Dialog */}
        <ConsolidateDialog
          isOpen={isConsolidateDialogOpen}
          onOpenChange={(open) => {
            setIsConsolidateDialogOpen(open);
            if (!open) {
              setFocusedSongTitle(null);
            }
          }}
          consolidationTasks={consolidationTasks}
          setConsolidationTasks={setConsolidationTasks}
          songMetadata={songMetadata}
          masterSongs={masterSongs}
          applyConsolidation={applyConsolidation}
          initialFocusTitle={focusedSongTitle}
        />

        {/* Song Details Modal */}
        <SongDetailsDialog
          viewingSong={viewingSong}
          setViewingSong={setViewingSong}
          selectedSongsForChart={selectedSongsForChart}
          toggleSongSelection={toggleSongSelection}
          songMetadata={songMetadata}
          allSongs={stats.allSongs}
          updateSongThemes={updateSongThemes}
          onSaveSong={handleSaveSong}
          onDeleteSong={handleDeleteSong}
          onOpenConsolidation={(title) => {
            setViewingSong(null);
            startConsolidation(title);
          }}
          isAdmin={isAdmin}
        />

        {/* Unified Settings Dialog */}
        <UnifiedSettingsDialog
          isOpen={isSettingsOpen}
          onOpenChange={setIsSettingsOpen}
          searchQuery={songSettingsSearch}
          onSearchChange={setSongSettingsSearch}
          processingEmbeddings={processingEmbeddings}
          embeddingProgress={embeddingProgress}
          onProcessEmbeddings={handleProcessEmbeddings}
          generatingThemes={generatingThemes}
          themeProgress={themeProgress}
          onGenerateMissingThemes={handleGenerateMissingThemes}
          allSongs={stats.allSongs}
          updateSongThemes={updateSongThemes}
          exportData={exportData}
          clearData={clearData}
          deduplicateServices={handleDeduplicateServices}
          hasData={services.length > 0 || masterSongs.length > 0}
          isAdmin={isAdmin}
          currentUserEmail={userEmail || auth.currentUser?.email || null}
          handleFiles={handleFiles}
          services={services}
          updateServiceDate={handleUpdateServiceDate}
          servicesCount={services.length}
          songsCount={masterSongs.length}
          lastSyncTime={lastSyncTime}
        />

        <Toaster />
      </div>
    </div>
  );
}
