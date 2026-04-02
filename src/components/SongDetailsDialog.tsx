import React, { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Calendar, Loader2, Music, Plus, Save, Trash2, X } from 'lucide-react';
import { format } from 'date-fns';
import { SongUsage, SongMeta } from '../types';
import { ConfirmDialog } from './ConfirmDialog';
import { formatLyricLabel } from '../lib/songUtils';

interface SongDetailsDialogProps {
  viewingSong: SongUsage | null;
  setViewingSong: (song: SongUsage | null) => void;
  selectedSongsForChart: string[];
  toggleSongSelection: (title: string, e: React.MouseEvent) => void;
  songMetadata: Record<string, SongMeta>;
  allSongs: SongUsage[];
  updateSongThemes: (title: string, themes: string[]) => void;
  onSaveSong: (
    currentTitle: string,
    updates: { title: string; lyrics: string },
  ) => Promise<{ title: string; lyrics: string } | null>;
  onDeleteSong: (title: string) => Promise<void>;
  isAdmin: boolean;
}

export function SongDetailsDialog({
  viewingSong,
  setViewingSong,
  selectedSongsForChart,
  toggleSongSelection,
  songMetadata,
  allSongs,
  updateSongThemes,
  onSaveSong,
  onDeleteSong,
  isAdmin,
}: SongDetailsDialogProps) {
  const [newTheme, setNewTheme] = useState('');
  const [editedTitle, setEditedTitle] = useState('');
  const [editedLyrics, setEditedLyrics] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isConfirmDeleteOpen, setIsConfirmDeleteOpen] = useState(false);
  const [isEditingLyrics, setIsEditingLyrics] = useState(false);

  const normalizeLyricsText = (lyrics?: string) =>
    (lyrics || '')
      .replace(/\\r\\n/g, '\n')
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\n');

  useEffect(() => {
    setEditedTitle(viewingSong?.title || '');
    setEditedLyrics(normalizeLyricsText(viewingSong?.lyrics));
    setNewTheme('');
    setIsSaving(false);
    setIsDeleting(false);
    setIsConfirmDeleteOpen(false);
    setIsEditingLyrics(false);
  }, [viewingSong]);

  const handleAddTheme = () => {
    if (!viewingSong || !newTheme.trim()) return;
    const themeToAdd = newTheme.trim();

    const currentMeta = songMetadata[viewingSong.title] || {
      lyrics: viewingSong.lyrics || '',
      themes: viewingSong.themes || [],
    };
    const currentThemes = currentMeta.themes || [];
    if (currentThemes.includes(themeToAdd)) return;

    const updatedThemes = [...currentThemes, themeToAdd];
    updateSongThemes(viewingSong.title, updatedThemes);
    setViewingSong({ ...viewingSong, themes: updatedThemes });
    setNewTheme('');
  };

  const handleRemoveTheme = (themeToRemove: string) => {
    if (!viewingSong) return;

    const currentMeta = songMetadata[viewingSong.title];
    if (!currentMeta || !currentMeta.themes) return;

    const updatedThemes = currentMeta.themes.filter((theme) => theme !== themeToRemove);
    updateSongThemes(viewingSong.title, updatedThemes);
    setViewingSong({ ...viewingSong, themes: updatedThemes });
  };

  const handleSave = async () => {
    if (!viewingSong) return;
    const lyricsChanged = editedLyrics !== (viewingSong.lyrics || '');
    setIsSaving(true);

    try {
      const result = await onSaveSong(viewingSong.title, {
        title: editedTitle,
        lyrics: editedLyrics,
      });

      if (!result) {
        return;
      }

      setEditedTitle(result.title);
      setEditedLyrics(result.lyrics);
      setIsEditingLyrics(false);
      setViewingSong({
        ...viewingSong,
        title: result.title,
        lyrics: result.lyrics,
        parts: lyricsChanged ? undefined : viewingSong.parts,
        verse_order: lyricsChanged ? undefined : viewingSong.verse_order,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!viewingSong) return;
    setIsDeleting(true);
    try {
      await onDeleteSong(viewingSong.title);
    } finally {
      setIsDeleting(false);
      setIsConfirmDeleteOpen(false);
    }
  };

  const hasChanges =
    !!viewingSong &&
    (editedTitle.trim() !== viewingSong.title ||
      editedLyrics !== (viewingSong.lyrics || ''));

  const partsToRender =
    !isEditingLyrics && viewingSong?.parts && viewingSong.parts.length > 0
      ? viewingSong.parts
      : [];

  const relatedSongs =
    viewingSong?.themes && viewingSong.themes.length > 0
      ? [...allSongs]
          .filter(
            (song) =>
              song.title !== viewingSong.title &&
              song.themes?.some((theme) => viewingSong.themes?.includes(theme)),
          )
          .map((song) => {
            const sharedThemes =
              song.themes?.filter((theme) => viewingSong.themes?.includes(theme)) || [];

            return {
              song,
              sharedThemes,
            };
          })
          .sort((a, b) => {
            if (b.sharedThemes.length !== a.sharedThemes.length) {
              return b.sharedThemes.length - a.sharedThemes.length;
            }
            if (b.song.count !== a.song.count) {
              return b.song.count - a.song.count;
            }
            return b.song.lastUsed.getTime() - a.song.lastUsed.getTime();
          })
          .slice(0, 3)
      : [];

  return (
    <>
      <Dialog open={!!viewingSong} onOpenChange={(open) => !open && setViewingSong(null)}>
        <DialogContent className="sm:max-w-[900px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl">{viewingSong?.title}</DialogTitle>
            <DialogDescription>
              Detailed usage history and editable song information.
            </DialogDescription>
          </DialogHeader>

          {viewingSong && (
            <div className="space-y-6">
              <div className="flex flex-col gap-2">
                <div className="text-sm font-medium text-slate-700">Themes</div>
                <div className="flex flex-wrap gap-2 items-center">
                  {viewingSong.themes && viewingSong.themes.length > 0 ? (
                    viewingSong.themes.map((theme) => (
                      <Badge
                        key={theme}
                        variant="secondary"
                        className="bg-indigo-50 text-indigo-700 border-indigo-100 flex items-center gap-1 pr-1"
                      >
                        {theme}
                        <button
                          onClick={() => handleRemoveTheme(theme)}
                          className="hover:bg-indigo-200 rounded-full p-0.5 transition-colors"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))
                  ) : (
                    <span className="text-sm text-slate-500 italic">No themes</span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <Input
                    placeholder="Add a theme..."
                    value={newTheme}
                    onChange={(e) => setNewTheme(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddTheme()}
                    className="w-48 h-8 text-sm"
                  />
                  <Button size="sm" variant="outline" onClick={handleAddTheme} className="h-8">
                    <Plus className="h-4 w-4 mr-1" /> Add
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="bg-slate-50 p-3 rounded-lg border">
                  <div className="text-xs text-slate-500 font-medium mb-1">Total Plays</div>
                  <div className="text-2xl font-bold text-indigo-600">{viewingSong.count}</div>
                </div>
                <div className="bg-slate-50 p-3 rounded-lg border">
                  <div className="text-xs text-slate-500 font-medium mb-1">AM / PM</div>
                  <div className="text-sm font-semibold mt-2">{viewingSong.amCount} / {viewingSong.pmCount}</div>
                </div>
                <div className="bg-slate-50 p-3 rounded-lg border">
                  <div className="text-xs text-slate-500 font-medium mb-1">First Played</div>
                  <div className="text-sm font-semibold mt-2">{viewingSong.count === 0 ? 'Never' : format(viewingSong.firstUsed, 'MMM d, yy')}</div>
                </div>
                <div className="bg-slate-50 p-3 rounded-lg border">
                  <div className="text-xs text-slate-500 font-medium mb-1">Last Played</div>
                  <div className="text-sm font-semibold mt-2">{viewingSong.count === 0 ? 'Never' : format(viewingSong.lastUsed, 'MMM d, yy')}</div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div className="rounded-md border p-4 bg-white space-y-3">
                    <div>
                      <label className="text-sm font-medium text-slate-700">Song Title</label>
                      <Input
                        value={editedTitle}
                        onChange={(e) => setEditedTitle(e.target.value)}
                        className="mt-2"
                      />
                    </div>
                    {!isAdmin && editedTitle.trim() !== viewingSong.title && (
                      <p className="text-xs text-amber-600">
                        Renaming a song requires admin access because service history references must be updated.
                      </p>
                    )}
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <Button
                        onClick={handleSave}
                        disabled={!hasChanges || isSaving}
                        className="bg-indigo-600 hover:bg-indigo-700"
                      >
                        {isSaving ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Save className="h-4 w-4 mr-2" />
                        )}
                        Save Changes
                      </Button>
                      <Button
                        variant="destructive"
                        onClick={() => setIsConfirmDeleteOpen(true)}
                        disabled={isDeleting}
                      >
                        {isDeleting ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4 mr-2" />
                        )}
                        Delete Song
                      </Button>
                    </div>
                  </div>

                  <div>
                    <h4 className="font-semibold mb-3 flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-slate-500" />
                      Service History
                    </h4>
                    <ScrollArea className="h-[420px] rounded-md border p-4">
                      <div className="space-y-3">
                        {viewingSong.datesUsed.map((usage, index) => (
                          <div key={index} className="flex items-center justify-between border-b border-slate-100 pb-2 last:border-0 last:pb-0">
                            <span className="font-medium text-slate-700">{format(usage.date, 'MMMM d, yyyy')}</span>
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-[10px]">{usage.type}</Badge>
                              <span className="text-xs text-slate-400 w-16 text-right">{format(usage.date, 'EEEE')}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </div>
                </div>

                <div>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h4 className="font-semibold flex items-center gap-2">
                      <Music className="h-4 w-4 text-slate-500" />
                      Lyrics
                    </h4>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setIsEditingLyrics((prev) => !prev)}
                    >
                      {isEditingLyrics ? 'Preview Lyrics' : 'Edit Lyrics'}
                    </Button>
                  </div>
                  <div className="h-[600px] rounded-md border p-4 bg-slate-50 overflow-y-auto overflow-x-hidden">
                    {isEditingLyrics ? (
                      <textarea
                        value={editedLyrics}
                        onChange={(e) => setEditedLyrics(e.target.value)}
                        className="h-full min-h-[540px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        placeholder="Song lyrics"
                      />
                    ) : partsToRender.length > 0 ? (
                      <div className="text-sm text-slate-700 whitespace-pre-wrap break-words font-sans w-full space-y-4">
                        {partsToRender.map((part, index) => (
                          <div key={`${part.type}-${part.label}-${index}`} className={part.type.toLowerCase() === 'c' ? 'pl-6 italic text-slate-600' : ''}>
                            <div className="font-semibold text-xs text-slate-500 mb-1 uppercase tracking-wider">
                              {formatLyricLabel(part.type, part.label)}
                            </div>
                            {part.text}
                          </div>
                        ))}
                      </div>
                    ) : editedLyrics ? (
                      <div className="text-sm text-slate-700 whitespace-pre-wrap break-words font-sans w-full">
                        {normalizeLyricsText(editedLyrics)}
                      </div>
                    ) : (
                      <div className="text-sm text-slate-400 italic">
                        No lyrics saved for this song.
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex justify-end">
                <Button
                  variant={selectedSongsForChart.includes(viewingSong.title) ? 'secondary' : 'default'}
                  onClick={(e) => {
                    toggleSongSelection(viewingSong.title, e);
                    setViewingSong(null);
                  }}
                >
                  {selectedSongsForChart.includes(viewingSong.title) ? 'Remove from Chart' : 'Add to Chart'}
                </Button>
              </div>

              {relatedSongs.length > 0 && (
                <div className="border-t pt-4">
                  <div className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
                    Related Songs
                  </div>
                  <div className="flex flex-col gap-2">
                    {relatedSongs.map(({ song, sharedThemes }) => (
                      <button
                        key={song.title}
                        type="button"
                        onClick={() => setViewingSong(song)}
                        className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50/70 px-3 py-2 text-left transition-colors hover:border-slate-300 hover:bg-slate-100"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm text-slate-700">{song.title}</div>
                          <div className="mt-1 text-xs text-slate-500">
                            {sharedThemes.slice(0, 2).join(', ')}
                            {sharedThemes.length > 2 ? ` +${sharedThemes.length - 2}` : ''}
                          </div>
                        </div>
                        <div className="ml-4 shrink-0 text-xs text-slate-400">
                          {song.count > 0 ? format(song.lastUsed, 'MMM d, yy') : 'Never'}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        isOpen={isConfirmDeleteOpen}
        onOpenChange={setIsConfirmDeleteOpen}
        title="Delete Song?"
        description={`Delete "${viewingSong?.title}" from Firebase and remove it from all service records? This cannot be undone.`}
        confirmText="Delete Song"
        destructive={true}
        onConfirm={handleDelete}
      />
    </>
  );
}
