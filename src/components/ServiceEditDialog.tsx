import React from 'react';
import { format } from 'date-fns';
import { Loader2, Plus, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ServiceData } from '../types';
import { extractDateFromFilename } from '../lib/songUtils';

interface ServiceEditDialogProps {
  service: ServiceData | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  availableSongs: string[];
  onSave: (serviceId: string, songs: string[]) => Promise<void>;
}

export function ServiceEditDialog({
  service,
  open,
  onOpenChange,
  availableSongs,
  onSave,
}: ServiceEditDialogProps) {
  const [draftSongs, setDraftSongs] = React.useState<string[]>([]);
  const [songSearch, setSongSearch] = React.useState('');
  const [isSaving, setIsSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open || !service) return;

    setDraftSongs([...service.songs]);
    setSongSearch('');
    setIsSaving(false);
  }, [open, service]);

  const catalog = React.useMemo(
    () =>
      Array.from(
        new Set(
          availableSongs
            .map((title) => title.trim())
            .filter(Boolean),
        ),
      ).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })),
    [availableSongs],
  );

  const matchingSongs = React.useMemo(() => {
    const query = songSearch.trim().toLowerCase();
    if (!query) return [];

    const selected = new Set(draftSongs);
    return catalog
      .filter((title) => !selected.has(title) && title.toLowerCase().includes(query))
      .slice(0, 30);
  }, [catalog, draftSongs, songSearch]);

  const hasChanges = React.useMemo(() => {
    if (!service || service.songs.length !== draftSongs.length) return true;
    return service.songs.some((song, index) => song !== draftSongs[index]);
  }, [draftSongs, service]);

  if (!service) return null;

  const serviceDate = extractDateFromFilename(service.fileName, service.date);

  const addSong = (title: string) => {
    setDraftSongs((current) => (current.includes(title) ? current : [...current, title]));
    setSongSearch('');
  };

  const removeSong = (index: number) => {
    setDraftSongs((current) => current.filter((_, songIndex) => songIndex !== index));
  };

  const saveChanges = async () => {
    if (!service.id) {
      toast.error('This service does not have a Firebase record ID.');
      return;
    }

    try {
      setIsSaving(true);
      await onSave(service.id, draftSongs);
      toast.success(`Updated the ${service.serviceType} service history.`);
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update the service.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={isSaving ? undefined : onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-[calc(100vw-2rem)] max-w-2xl flex-col overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-5 pb-4 pt-5 pr-12">
          <DialogTitle>Edit {service.serviceType} Service</DialogTitle>
          <DialogDescription>
            {format(serviceDate, 'EEEE, d MMMM yyyy')}
            {service.fileName ? ` - ${service.fileName}` : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-1">
          <section aria-labelledby="recorded-songs-heading">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 id="recorded-songs-heading" className="font-medium text-slate-900">
                Recorded songs
              </h3>
              <span className="text-xs text-slate-500">
                {draftSongs.length} {draftSongs.length === 1 ? 'song' : 'songs'}
              </span>
            </div>

            {draftSongs.length === 0 ? (
              <div className="border border-dashed p-4 text-sm text-slate-500">
                No songs are recorded for this service.
              </div>
            ) : (
              <ol className="divide-y border">
                {draftSongs.map((song, index) => (
                  <li key={`${song}-${index}`} className="flex min-h-11 items-center gap-3 px-3 py-2">
                    <span className="w-5 shrink-0 text-right text-xs tabular-nums text-slate-400">
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1 break-words text-sm text-slate-800">{song}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="text-slate-500 hover:text-red-600"
                      onClick={() => removeSong(index)}
                      aria-label={`Remove ${song}`}
                      title="Remove song"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section aria-labelledby="add-song-heading" className="pb-4">
            <h3 id="add-song-heading" className="mb-2 font-medium text-slate-900">
              Add a song
            </h3>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={songSearch}
                onChange={(event) => setSongSearch(event.target.value)}
                placeholder="Search the song library..."
                className="pl-9"
                autoComplete="off"
              />
            </div>

            {songSearch.trim() && (
              <div className="mt-2 max-h-56 overflow-y-auto border">
                {matchingSongs.length === 0 ? (
                  <p className="p-3 text-sm text-slate-500">No unselected songs match this search.</p>
                ) : (
                  <ul className="divide-y">
                    {matchingSongs.map((song) => (
                      <li key={song}>
                        <button
                          type="button"
                          className="flex min-h-10 w-full items-center gap-3 px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                          onClick={() => addSong(song)}
                        >
                          <Plus className="h-4 w-4 shrink-0 text-indigo-600" />
                          <span className="break-words">{song}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>
        </div>

        <DialogFooter className="mx-0 mb-0 rounded-none px-5 py-4">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button type="button" onClick={saveChanges} disabled={!service.id || !hasChanges || isSaving}>
            {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
