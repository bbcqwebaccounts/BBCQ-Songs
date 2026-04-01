import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sparkles, Loader2 } from 'lucide-react';
import { SongUsage, SongMeta } from '../types';
import { format } from 'date-fns';

interface AIRecommendationsProps {
  aiPrompt: string;
  setAiPrompt: (prompt: string) => void;
  getAiRecommendations: (loadMore?: boolean) => void;
  isAiLoading: boolean;
  aiRecommendations: { title: string; reason: string }[] | null;
  setAiRecommendations: (recs: { title: string; reason: string }[] | null) => void;
  allSongs: SongUsage[];
  songMetadata: Record<string, SongMeta>;
  setViewingSong: (song: SongUsage | null) => void;
}

export function AIRecommendations({
  aiPrompt,
  setAiPrompt,
  getAiRecommendations,
  isAiLoading,
  aiRecommendations,
  setAiRecommendations,
  allSongs,
  songMetadata,
  setViewingSong
}: AIRecommendationsProps) {
  return (
    <Card className="border-indigo-100 shadow-sm bg-white overflow-hidden">
      <CardHeader className="bg-indigo-50/50 border-b border-indigo-50 pb-4">
        <CardTitle className="flex items-center gap-2 text-indigo-800">
          <Sparkles className="h-5 w-5 text-indigo-600" />
          AI Song Recommendations
        </CardTitle>
        <CardDescription className="text-indigo-600/80">
          Describe your sermon topic, scripture, or theme, and AI will recommend relevant songs from your database.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-6">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1">
            <textarea
              className="flex min-h-[80px] w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm ring-offset-white placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
              placeholder="e.g., A sermon about God's grace and forgiveness, referencing Ephesians 2..."
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
            />
          </div>
          <Button 
            onClick={getAiRecommendations} 
            disabled={isAiLoading || !aiPrompt.trim()}
            className="bg-indigo-600 hover:bg-indigo-700 text-white h-auto py-4 md:py-2 md:w-48"
          >
            {isAiLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" />
                Get Recommendations
              </>
            )}
          </Button>
        </div>

        {aiRecommendations && aiRecommendations.length > 0 && (
          <div className="mt-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-slate-500 uppercase tracking-wider">Recommended Songs</h3>
              <button 
                onClick={() => setAiRecommendations([])}
                className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
              >
                Clear
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {aiRecommendations.map((rec, idx) => {
                const songData = allSongs.find(s => s.title === rec.title);
                return (
                  <Card 
                    key={idx} 
                    className="cursor-pointer hover:border-indigo-300 hover:shadow-md transition-all group"
                    onClick={() => {
                      if (songData) setViewingSong(songData);
                      else {
                        setViewingSong({
                          title: rec.title,
                          count: 0, amCount: 0, pmCount: 0,
                          firstUsed: new Date(), lastUsed: new Date(),
                          datesUsed: [],
                          lyrics: songMetadata[rec.title]?.lyrics,
                          themes: songMetadata[rec.title]?.themes
                        });
                      }
                    }}
                  >
                    <CardHeader className="p-4 pb-2">
                      <CardTitle className="text-base group-hover:text-indigo-600 transition-colors">
                        {rec.title}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                      <p className="text-sm text-slate-600 italic mb-3">{rec.reason}</p>
                      <div className="grid grid-cols-2 gap-2 mb-3">
                        <div className="rounded-md border bg-slate-50 px-3 py-2">
                          <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                            Times Used
                          </div>
                          <div className="text-sm font-semibold text-slate-900">
                            {songData ? songData.count : 0}
                          </div>
                        </div>
                        <div className="rounded-md border bg-slate-50 px-3 py-2">
                          <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                            Last Used
                          </div>
                          <div className="text-sm font-semibold text-slate-900">
                            {songData && songData.count > 0 ? format(songData.lastUsed, 'MMM d, yyyy') : 'Never'}
                          </div>
                        </div>
                      </div>
                      {songData?.themes && songData.themes.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {songData.themes.slice(0, 3).map(t => (
                            <Badge key={t} variant="secondary" className="text-[10px] px-1.5 py-0">{t}</Badge>
                          ))}
                          {songData.themes.length > 3 && (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">+{songData.themes.length - 3}</Badge>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
            <div className="flex justify-center mt-4">
              <Button 
                variant="outline" 
                onClick={() => getAiRecommendations(true)}
                disabled={isAiLoading}
              >
                {isAiLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Searching deeper...
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-2 h-4 w-4" />
                    Get More Recommendations
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
