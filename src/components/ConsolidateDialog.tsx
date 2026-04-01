import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Search, CheckCircle2 } from 'lucide-react';
import { ConfirmDialog } from './ConfirmDialog';

interface ConsolidationTask {
  originalTitle: string;
  originalFirstLine?: string;
  selectedMatch: string | null;
  status: 'exact' | 'auto' | 'manual' | 'unmatched' | 'new';
  confidence?: number;
}

interface ConsolidateDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  consolidationTasks: ConsolidationTask[];
  setConsolidationTasks: React.Dispatch<React.SetStateAction<ConsolidationTask[]>>;
  songMetadata: Record<string, { lyrics?: string; themes?: string[] }>;
  masterSongs: any[];
  applyConsolidation: () => void;
}

export function ConsolidateDialog({
  isOpen,
  onOpenChange,
  consolidationTasks,
  setConsolidationTasks,
  songMetadata,
  masterSongs,
  applyConsolidation
}: ConsolidateDialogProps) {
  const [consolidationFilter, setConsolidationFilter] = useState<'all' | 'unmatched' | 'auto' | 'exact' | 'manual' | 'new'>('all');
  const [activeSearch, setActiveSearch] = useState<string | null>(null);
  const [masterSearchTerm, setMasterSearchTerm] = useState('');
  const [taskToAddNew, setTaskToAddNew] = useState<ConsolidationTask | null>(null);

  const confirmAddNew = () => {
    if (!taskToAddNew) return;
    const newTasks = [...consolidationTasks];
    const taskIndex = newTasks.findIndex(t => t.originalTitle === taskToAddNew.originalTitle);
    if (taskIndex !== -1) {
      newTasks[taskIndex].selectedMatch = taskToAddNew.originalTitle;
      newTasks[taskIndex].status = 'new';
    }
    setConsolidationTasks(newTasks);
    setTaskToAddNew(null);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[800px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl">Consolidate Songs</DialogTitle>
          <DialogDescription>
            Review and match imported songs to the master SQLite database.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex gap-2 mb-4">
            <Button 
              variant={consolidationFilter === 'unmatched' ? 'default' : 'outline'} 
              onClick={() => setConsolidationFilter('unmatched')}
              size="sm"
            >
              Unmatched ({consolidationTasks.filter(t => t.status === 'unmatched').length})
            </Button>
            <Button 
              variant={consolidationFilter === 'auto' ? 'default' : 'outline'} 
              onClick={() => setConsolidationFilter('auto')}
              size="sm"
            >
              Auto-Matched ({consolidationTasks.filter(t => t.status === 'auto').length})
            </Button>
            <Button 
              variant={consolidationFilter === 'exact' ? 'default' : 'outline'} 
              onClick={() => setConsolidationFilter('exact')}
              size="sm"
            >
              Exact Match ({consolidationTasks.filter(t => t.status === 'exact').length})
            </Button>
            <Button 
              variant={consolidationFilter === 'manual' ? 'default' : 'outline'} 
              onClick={() => setConsolidationFilter('manual')}
              size="sm"
            >
              Manual ({consolidationTasks.filter(t => t.status === 'manual').length})
            </Button>
            <Button 
              variant={consolidationFilter === 'new' ? 'default' : 'outline'} 
              onClick={() => setConsolidationFilter('new')}
              size="sm"
            >
              New ({consolidationTasks.filter(t => t.status === 'new').length})
            </Button>
            <Button 
              variant={consolidationFilter === 'all' ? 'default' : 'outline'} 
              onClick={() => setConsolidationFilter('all')}
              size="sm"
            >
              All ({consolidationTasks.length})
            </Button>
          </div>

          <ScrollArea className="h-[600px] rounded-md border p-4">
            <div className="space-y-4">
              {consolidationTasks
                .filter(t => consolidationFilter === 'all' || t.status === consolidationFilter)
                .map((task, index) => (
                <div key={index} className="p-4 border rounded-lg bg-slate-50">
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex-1 min-w-0 pr-4">
                      <h4 className="font-semibold text-slate-900 text-base">{task.originalTitle}</h4>
                      {songMetadata[task.originalTitle]?.lyrics ? (
                        <p className="text-xs text-slate-600 mt-1.5 line-clamp-3 whitespace-pre-wrap bg-white p-2 rounded border border-slate-200">
                          {songMetadata[task.originalTitle].lyrics}
                        </p>
                      ) : task.originalFirstLine ? (
                        <p className="text-xs text-slate-500 italic mt-1">"{task.originalFirstLine}"</p>
                      ) : null}
                    </div>
                    <Badge variant={task.status === 'unmatched' ? 'destructive' : 'default'}>
                      {task.status === 'unmatched' ? 'Needs Match' : 'Matched'}
                    </Badge>
                  </div>

                  <div className="mt-3">
                    {activeSearch === task.originalTitle ? (
                      <div className="space-y-2">
                        <div className="relative">
                          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                          <Input
                            type="search"
                            placeholder="Search master database..."
                            className="pl-9"
                            value={masterSearchTerm}
                            onChange={(e) => setMasterSearchTerm(e.target.value)}
                            autoFocus
                          />
                        </div>
                        <ScrollArea className="h-[300px] border rounded-md">
                          {masterSongs
                            .filter(s => 
                              s.title.toLowerCase().includes(masterSearchTerm.toLowerCase()) || 
                              (s.alternate_title && s.alternate_title.toLowerCase().includes(masterSearchTerm.toLowerCase())) ||
                              (s.lyrics && s.lyrics.toLowerCase().includes(masterSearchTerm.toLowerCase()))
                            )
                            .slice(0, 20)
                            .map(s => (
                              <div 
                                key={s.id} 
                                className="p-3 hover:bg-slate-100 cursor-pointer border-b last:border-0 text-sm"
                                onClick={() => {
                                  const newTasks = [...consolidationTasks];
                                  const taskIndex = newTasks.findIndex(t => t.originalTitle === task.originalTitle);
                                  if (taskIndex !== -1) {
                                    newTasks[taskIndex].selectedMatch = s.title;
                                    newTasks[taskIndex].status = 'manual';
                                  }
                                  setConsolidationTasks(newTasks);
                                  setActiveSearch(null);
                                  setMasterSearchTerm('');
                                }}
                              >
                                <div className="font-medium text-base">{s.title}</div>
                                {s.alternate_title && <div className="text-xs text-slate-500 font-medium">Alt: {s.alternate_title}</div>}
                                {s.lyrics && <div className="text-xs text-slate-500 line-clamp-3 mt-1.5 whitespace-pre-wrap">{s.lyrics}</div>}
                              </div>
                            ))}
                        </ScrollArea>
                        <Button variant="ghost" size="sm" onClick={() => setActiveSearch(null)}>Cancel</Button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between bg-white p-2 rounded border">
                          <span className="text-sm font-medium text-slate-700">
                            {task.selectedMatch ? (
                              <span className="flex items-center gap-2">
                                <CheckCircle2 className="h-4 w-4 text-green-500" />
                                {task.selectedMatch}
                              </span>
                            ) : (
                              <span className="text-slate-400 italic">No match selected</span>
                            )}
                          </span>
                          <Button 
                            variant="outline" 
                            size="sm" 
                            onClick={() => {
                              setActiveSearch(task.originalTitle);
                              setMasterSearchTerm(task.originalTitle);
                            }}
                          >
                            {task.selectedMatch ? 'Change Match' : 'Find Match'}
                          </Button>
                        </div>
                        {task.status === 'unmatched' && (
                          <Button 
                            variant="secondary" 
                            size="sm" 
                            className="w-full"
                            onClick={() => setTaskToAddNew(task)}
                          >
                            Add as New Song
                          </Button>
                        )}
                        {task.status === 'new' && (
                          <div className="text-sm text-green-600 font-medium flex items-center gap-2">
                            <CheckCircle2 className="h-4 w-4" />
                            Will be added as new song
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={applyConsolidation}>
              Apply Consolidation
            </Button>
          </div>
        </div>
      </DialogContent>

      <ConfirmDialog
        isOpen={taskToAddNew !== null}
        onOpenChange={(open) => !open && setTaskToAddNew(null)}
        title="Add as New Song?"
        description={`Are you sure you want to add "${taskToAddNew?.originalTitle}" as a new song? Only do this if you are sure it's not already in the database.`}
        confirmText="Add as New"
        onConfirm={confirmAddNew}
      />
    </Dialog>
  );
}
