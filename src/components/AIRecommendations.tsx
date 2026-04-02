import React from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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
  setViewingSong,
}: AIRecommendationsProps) {
  const handleGetRecommendations = () => getAiRecommendations(false);
  const promptSuggestions = [
    'Grace and forgiveness',
    'Psalm 23 comfort',
    'The cross and redemption',
    "God's faithfulness",
  ];

  return (
    <Card className="overflow-hidden border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#fcfcff_100%)] shadow-[0_18px_40px_-26px_rgba(79,70,229,0.32)]">
      <CardHeader className="border-b border-slate-100 bg-[linear-gradient(135deg,rgba(238,242,255,0.95),rgba(255,255,255,0.94))] pb-5">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-indigo-600/10 text-indigo-700 shadow-inner">
            <Sparkles className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-indigo-500/80">
              Sermon Match
            </div>
            <CardTitle className="text-xl text-slate-900">
              AI Song Recommendations
            </CardTitle>
            <CardDescription className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
              Describe your sermon topic, scripture, or theme and the app will suggest songs from your database that fit naturally.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_10px_30px_-24px_rgba(15,23,42,0.6)]">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Sermon Prompt
            </div>
            <div className="hidden text-xs text-slate-400 md:block">
              Ask for themes, scriptures, moods, or occasions
            </div>
          </div>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
            <div className="flex-1">
              <textarea
                className="min-h-[124px] w-full rounded-2xl border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8faff_100%)] px-4 py-3 text-sm leading-6 text-slate-700 shadow-inner ring-offset-white placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
                placeholder="Try a sermon on grace and forgiveness in Ephesians 2, a Psalm 23 service, or a message about Christ's finished work."
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
              />
            </div>
            <Button
              onClick={handleGetRecommendations}
              disabled={isAiLoading || !aiPrompt.trim()}
              className="h-12 rounded-2xl bg-[linear-gradient(135deg,#4f46e5_0%,#7c6cf2_100%)] px-6 text-white shadow-[0_14px_30px_-18px_rgba(79,70,229,0.75)] transition-all hover:brightness-105 hover:shadow-[0_18px_36px_-18px_rgba(79,70,229,0.85)] lg:min-w-[220px]"
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
          <div className="mt-4 flex flex-wrap gap-2">
            {promptSuggestions.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => setAiPrompt(prompt)}
                className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700"
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>

        {aiRecommendations && aiRecommendations.length > 0 && (
          <div className="mt-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium uppercase tracking-wider text-slate-500">
                Recommended Songs
              </h3>
              <button
                onClick={() => setAiRecommendations([])}
                className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
              >
                Clear
              </button>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {aiRecommendations.map((rec, idx) => {
                const songData = allSongs.find((song) => song.title === rec.title);
                return (
                  <Card
                    key={idx}
                    className="group cursor-pointer transition-all hover:border-indigo-300 hover:shadow-md"
                    onClick={() => {
                      if (songData) {
                        setViewingSong(songData);
                      } else {
                        setViewingSong({
                          title: rec.title,
                          count: 0,
                          amCount: 0,
                          pmCount: 0,
                          firstUsed: new Date(),
                          lastUsed: new Date(),
                          datesUsed: [],
                          lyrics: songMetadata[rec.title]?.lyrics,
                          themes: songMetadata[rec.title]?.themes,
                        });
                      }
                    }}
                  >
                    <CardHeader className="p-4 pb-2">
                      <CardTitle className="text-base transition-colors group-hover:text-indigo-600">
                        {rec.title}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                      <p className="mb-3 text-sm italic text-slate-600">{rec.reason}</p>
                      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                        <span>
                          <span className="font-medium text-slate-400">Used</span>{' '}
                          <span className="text-slate-600">
                            {songData ? songData.count : 0} times
                          </span>
                        </span>
                        <span className="text-slate-300">|</span>
                        <span>
                          <span className="font-medium text-slate-400">Last</span>{' '}
                          <span className="text-slate-600">
                            {songData && songData.count > 0
                              ? format(songData.lastUsed, 'MMM d, yyyy')
                              : 'Never'}
                          </span>
                        </span>
                      </div>
                      {songData?.themes && songData.themes.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {songData.themes.slice(0, 3).map((theme) => (
                            <Badge key={theme} variant="secondary" className="px-1.5 py-0 text-[10px]">
                              {theme}
                            </Badge>
                          ))}
                          {songData.themes.length > 3 && (
                            <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                              +{songData.themes.length - 3}
                            </Badge>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
            <div className="mt-4 flex justify-center">
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
