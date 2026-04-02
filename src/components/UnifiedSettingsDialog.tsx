import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Search, Loader2, Sparkles, Database, CheckCircle2, X, Tags, Cloud, Save, Trash2 } from 'lucide-react';
import { SongUsage, SongMeta } from '../types';
import { toast } from 'sonner';

import { ConfirmDialog } from './ConfirmDialog';

interface UnifiedSettingsDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  // Song Settings
  searchQuery: string;
  onSearchChange: (query: string) => void;
  processingEmbeddings: boolean;
  embeddingProgress: { current: number; total: number };
  onProcessEmbeddings: (unprocessedOnly: boolean) => void;
  generatingThemes: boolean;
  themeProgress: { current: number; total: number };
  onGenerateMissingThemes: () => void;
  allSongs: SongUsage[];
  updateSongThemes: (title: string, themes: string[]) => void;
  // Data Management
  exportData: () => void;
  clearData: () => void;
  hasData: boolean;
  isAdmin: boolean;
  currentUserEmail: string | null;
  handleFiles: (
    files: FileList | File[],
    options?: { jsonMode?: 'merge' | 'replace' },
  ) => Promise<void>;
  servicesCount: number;
  songsCount: number;
  lastSyncTime: Date | null;
}

export function UnifiedSettingsDialog({
  isOpen,
  onOpenChange,
  searchQuery,
  onSearchChange,
  processingEmbeddings,
  embeddingProgress,
  onProcessEmbeddings,
  generatingThemes,
  themeProgress,
  onGenerateMissingThemes,
  allSongs,
  updateSongThemes,
  exportData,
  clearData,
  hasData,
  isAdmin,
  currentUserEmail,
  handleFiles,
  servicesCount,
  songsCount,
  lastSyncTime
}: UnifiedSettingsDialogProps) {
  const [isConfirmClearOpen, setIsConfirmClearOpen] = React.useState(false);
  const [pendingSyncFile, setPendingSyncFile] = React.useState<File | null>(null);

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl sm:max-w-4xl w-[95vw] h-[90vh] flex flex-col p-4 md:p-6">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Manage your application settings, data, and AI features.</DialogDescription>
        </DialogHeader>
        
        <Tabs defaultValue="songs" className="flex-1 flex flex-col overflow-hidden mt-2">
          <TabsList className={`grid w-full mb-4 ${isAdmin ? 'grid-cols-3' : 'grid-cols-2'}`}>
            <TabsTrigger value="songs">Songs & AI</TabsTrigger>
            <TabsTrigger value="data">Data</TabsTrigger>
            {isAdmin && <TabsTrigger value="users">Users</TabsTrigger>}
          </TabsList>

          <TabsContent value="songs" className="flex-1 flex flex-col overflow-hidden m-0">
            <div className="flex flex-col gap-4 flex-1 overflow-hidden">
              <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div className="flex items-center gap-2 w-full md:w-auto flex-1">
                  <Search className="h-4 w-4 text-slate-400" />
                  <Input 
                    placeholder="Search songs to edit themes..." 
                    value={searchQuery}
                    onChange={(e) => onSearchChange(e.target.value)}
                    className="flex-1"
                  />
                </div>
                <div className="flex flex-wrap gap-2 w-full md:w-auto">
                  <Button 
                    variant="outline" 
                    onClick={onGenerateMissingThemes}
                    disabled={generatingThemes || processingEmbeddings}
                    className="flex-1 md:flex-none text-xs md:text-sm"
                  >
                    {generatingThemes ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Tags className="h-4 w-4 mr-2" />}
                    Generate Missing Themes
                  </Button>
                  <Button 
                    variant="outline" 
                    onClick={() => onProcessEmbeddings(true)}
                    disabled={processingEmbeddings || generatingThemes}
                    className="flex-1 md:flex-none text-xs md:text-sm"
                  >
                    {processingEmbeddings ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
                    Process Unprocessed
                  </Button>
                  <Button 
                    variant="default" 
                    onClick={() => onProcessEmbeddings(false)}
                    disabled={processingEmbeddings || generatingThemes}
                    className="flex-1 md:flex-none text-xs md:text-sm"
                  >
                    {processingEmbeddings ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Database className="h-4 w-4 mr-2" />}
                    Process All
                  </Button>
                </div>
              </div>

              {processingEmbeddings && (
                <div className="bg-indigo-50 text-indigo-700 p-3 rounded-md text-sm flex items-center justify-between">
                  <span>Processing embeddings... Please do not close this window.</span>
                  <span className="font-medium">{embeddingProgress.current} / {embeddingProgress.total}</span>
                </div>
              )}

              {generatingThemes && (
                <div className="bg-emerald-50 text-emerald-700 p-3 rounded-md text-sm flex items-center justify-between">
                  <span>Generating missing themes... Please do not close this window.</span>
                  <span className="font-medium">{themeProgress.current} / {themeProgress.total}</span>
                </div>
              )}

              <div className="flex-1 overflow-auto border rounded-md">
                <div className="min-w-[600px]">
                  <table className="w-full text-sm text-left">
                    <thead className="text-xs text-slate-500 uppercase bg-slate-50 sticky top-0 z-10">
                      <tr>
                        <th className="px-4 py-3 w-1/3">Song Title</th>
                        <th className="px-4 py-3 w-1/2">Themes (Comma separated)</th>
                        <th className="px-4 py-3 text-center w-1/6">Embedding</th>
                      </tr>
                    </thead>
                    <tbody>
                    {allSongs
                      .filter(s => s.title.toLowerCase().includes(searchQuery.toLowerCase()))
                      .slice(0, 100) // Limit to 100 for performance
                      .map(song => (
                        <tr key={song.title} className="border-b last:border-0 hover:bg-slate-50">
                            <td className="px-4 py-3 font-medium truncate max-w-[200px]" title={song.title}>{song.title}</td>
                            <td className="px-4 py-3">
                            <Input 
                              value={song.themes?.join(', ') || ''}
                              onChange={(e) => {
                                const newThemes = e.target.value.split(',').map(t => t.trim()).filter(t => t);
                                updateSongThemes(song.title, newThemes);
                              }}
                              placeholder="e.g. Praise, Grace"
                              className="h-8 text-xs"
                            />
                          </td>
                          <td className="px-4 py-3 text-center">
                            {song.embedding ? (
                              <CheckCircle2 className="h-4 w-4 text-green-500 mx-auto" />
                            ) : (
                              <X className="h-4 w-4 text-slate-300 mx-auto" />
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                  </table>
                </div>
                {allSongs.filter(s => s.title.toLowerCase().includes(searchQuery.toLowerCase())).length > 100 && (
                  <div className="p-4 text-center text-sm text-slate-500 bg-slate-50">
                    Showing first 100 results. Use search to find specific songs.
                  </div>
                )}
              </div>
            </div>
          </TabsContent>



          <TabsContent value="data" className="flex-1 overflow-auto m-0">
            <div className="space-y-6 py-4 max-w-2xl mx-auto">
              <div className="bg-white border rounded-lg p-6 space-y-4 shadow-sm">
                <div>
                  <h3 className="text-lg font-medium text-slate-900">Database Status</h3>
                  <p className="text-sm text-slate-500 mt-1">
                    Current status of your Firebase database.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-4 mt-4">
                  <div className="bg-slate-50 p-4 rounded-md border border-slate-100">
                    <p className="text-sm text-slate-500 font-medium">Total Songs</p>
                    <p className="text-2xl font-bold text-slate-900">{songsCount}</p>
                  </div>
                  <div className="bg-slate-50 p-4 rounded-md border border-slate-100">
                    <p className="text-sm text-slate-500 font-medium">Total Services</p>
                    <p className="text-2xl font-bold text-slate-900">{servicesCount}</p>
                  </div>
                  <div className="bg-slate-50 p-4 rounded-md border border-slate-100 col-span-2">
                    <p className="text-sm text-slate-500 font-medium">Last Sync</p>
                    <p className="text-lg font-medium text-slate-900">
                      {lastSyncTime ? lastSyncTime.toLocaleString() : 'Never'}
                    </p>
                  </div>
                </div>
                <div className={`rounded-md border p-4 text-sm ${isAdmin ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-amber-50 border-amber-100 text-amber-700'}`}>
                  <p className="font-medium">
                    {isAdmin ? 'Admin access is active.' : 'Admin access is not active.'}
                  </p>
                  <p className="mt-1">
                    {currentUserEmail
                      ? `Signed in as ${currentUserEmail}.`
                      : 'You are not currently signed in.'}
                    {' '}
                    Full replace sync, consolidation, deleting songs, and clearing all data require admin rights under the current Firebase rules.
                  </p>
                </div>
              </div>

              <div className="bg-white border rounded-lg p-6 space-y-4 shadow-sm">
                <div>
                  <h3 className="text-lg font-medium text-slate-900">Sync & Import Data</h3>
                  <p className="text-sm text-slate-500 mt-1">
                    Upload a `defaultData.json` backup to fully replace the Firebase `songs` and `services` collections. This clears existing data first and does not append.
                  </p>
                </div>
                <div className="relative">
                  <Input 
                    type="file" 
                    accept=".json" 
                    onChange={(e) => {
                      if (e.target.files && e.target.files.length > 0) {
                        setPendingSyncFile(e.target.files[0]);
                        e.target.value = '';
                      }
                    }}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                  <Button 
                    variant="outline" 
                    className="w-full sm:w-auto text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 border-indigo-200"
                  >
                    <Cloud className="h-4 w-4 mr-2" />
                    Replace From Backup JSON
                  </Button>
                </div>
                <p className="text-xs text-slate-500">
                  Use this for the attached backup export. The import on this screen is destructive by design.
                </p>
              </div>

              <div className="bg-white border rounded-lg p-6 space-y-4 shadow-sm">
                <div>
                  <h3 className="text-lg font-medium text-slate-900">Export Data</h3>
                  <p className="text-sm text-slate-500 mt-1">
                    Download a backup of your entire database, including song metadata, usage history, and AI embeddings.
                  </p>
                </div>
                <Button 
                  variant="outline" 
                  onClick={exportData} 
                  disabled={!hasData}
                  className="w-full sm:w-auto text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 border-indigo-200"
                >
                  <Save className="h-4 w-4 mr-2" />
                  Download Backup (JSON)
                </Button>
              </div>

              <div className="bg-red-50 border border-red-100 rounded-lg p-6 space-y-4">
                <div>
                  <h3 className="text-lg font-medium text-red-900">Danger Zone</h3>
                  <p className="text-sm text-red-600 mt-1">
                    Permanently delete all data from your browser's local storage and Firebase. This action cannot be undone unless you have a backup.
                  </p>
                </div>
                <Button 
                  variant="destructive" 
                  onClick={() => setIsConfirmClearOpen(true)} 
                  disabled={!hasData}
                  className="w-full sm:w-auto"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Clear All Data
                </Button>
              </div>
            </div>
          </TabsContent>

          {isAdmin && (
            <TabsContent value="users" className="flex-1 overflow-auto m-0">
              <div className="space-y-6 py-4 max-w-2xl mx-auto">
                <div className="bg-white border rounded-lg p-6 space-y-4 shadow-sm">
                  <div>
                    <h3 className="text-lg font-medium text-slate-900">Manage Users</h3>
                    <p className="text-sm text-slate-500 mt-1">
                      Manage user roles and permissions.
                    </p>
                  </div>
                  <UsersManager />
                </div>
              </div>
            </TabsContent>
          )}
        </Tabs>
      </DialogContent>

      <ConfirmDialog
        isOpen={isConfirmClearOpen}
        onOpenChange={setIsConfirmClearOpen}
        title="Clear All Data?"
        description="This will permanently delete all data from your browser's local storage and Firebase. This action cannot be undone unless you have a backup."
        confirmText="Clear Data"
        destructive={true}
        onConfirm={() => {
          clearData();
          setIsConfirmClearOpen(false);
          onOpenChange(false);
        }}
      />

      <ConfirmDialog
        isOpen={pendingSyncFile !== null}
        onOpenChange={(open) => !open && setPendingSyncFile(null)}
        title="Replace Firebase Data?"
        description={`This will delete the current songs and services in Firebase, then replace them with "${pendingSyncFile?.name}". This does not append. Continue?`}
        confirmText="Replace Data"
        destructive={true}
        onConfirm={async () => {
          if (!pendingSyncFile) return;
          await handleFiles([pendingSyncFile], { jsonMode: 'replace' });
          setPendingSyncFile(null);
        }}
      />
    </Dialog>
  );
}

function UsersManager() {
  const [users, setUsers] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [newUserEmail, setNewUserEmail] = React.useState('');
  const [newUserRole, setNewUserRole] = React.useState('user');
  const [userToDelete, setUserToDelete] = React.useState<string | null>(null);

  React.useEffect(() => {
    const fetchUsers = async () => {
      try {
        const { collection, getDocs } = await import('firebase/firestore');
        const { db } = await import('../firebase');
        const snapshot = await getDocs(collection(db, 'users'));
        const usersList: any[] = [];
        snapshot.forEach(doc => {
          usersList.push({ id: doc.id, ...doc.data() });
        });
        setUsers(usersList);
      } catch (error) {
        const { handleFirestoreError, OperationType } = await import('../firebase');
        handleFirestoreError(error, OperationType.GET, 'users');
      } finally {
        setLoading(false);
      }
    };
    fetchUsers();
  }, []);

  const handleUpdateRole = async (userId: string, newRole: string) => {
    try {
      const { doc, updateDoc } = await import('firebase/firestore');
      const { db } = await import('../firebase');
      await updateDoc(doc(db, 'users', userId), { role: newRole });
      setUsers(users.map(u => u.id === userId ? { ...u, role: newRole } : u));
      toast.success(`Updated role for ${userId}`);
    } catch (error) {
      const { handleFirestoreError, OperationType } = await import('../firebase');
      handleFirestoreError(error, OperationType.UPDATE, 'users');
    }
  };

  const handleAddUser = async () => {
    if (!newUserEmail.trim()) return;
    try {
      const { doc, setDoc } = await import('firebase/firestore');
      const { db } = await import('../firebase');
      const email = newUserEmail.trim().toLowerCase();
      await setDoc(doc(db, 'users', email), { email, role: newUserRole });
      setUsers([...users, { id: email, email, role: newUserRole }]);
      setNewUserEmail('');
      toast.success(`Added user ${email}`);
    } catch (error) {
      const { handleFirestoreError, OperationType } = await import('../firebase');
      handleFirestoreError(error, OperationType.WRITE, 'users');
    }
  };

  const handleDeleteUser = async (userId: string) => {
    setUserToDelete(userId);
  };

  const confirmDeleteUser = async () => {
    if (!userToDelete) return;
    try {
      const { doc, deleteDoc } = await import('firebase/firestore');
      const { db } = await import('../firebase');
      await deleteDoc(doc(db, 'users', userToDelete));
      setUsers(users.filter(u => u.id !== userToDelete));
      toast.success(`Removed user ${userToDelete}`);
    } catch (error) {
      const { handleFirestoreError, OperationType } = await import('../firebase');
      handleFirestoreError(error, OperationType.DELETE, 'users');
    } finally {
      setUserToDelete(null);
    }
  };

  if (loading) return <div className="flex justify-center p-4"><Loader2 className="h-6 w-6 animate-spin text-indigo-600" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Input 
          placeholder="New user email" 
          value={newUserEmail} 
          onChange={e => setNewUserEmail(e.target.value)} 
          className="flex-1"
        />
        <select 
          value={newUserRole} 
          onChange={e => setNewUserRole(e.target.value)}
          className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <option value="user">User</option>
          <option value="admin">Admin</option>
        </select>
        <Button onClick={handleAddUser}>Add User</Button>
      </div>
      
      <div className="border rounded-md divide-y">
        {users.map(user => (
          <div key={user.id} className="flex items-center justify-between p-3">
            <div className="font-medium">{user.email}</div>
            <div className="flex items-center gap-2">
              <select 
                value={user.role || 'user'} 
                onChange={e => handleUpdateRole(user.id, e.target.value)}
                className="h-8 rounded-md border border-input bg-background px-2 py-1 text-sm"
              >
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
              <Button variant="ghost" size="sm" onClick={() => handleDeleteUser(user.id)} className="text-red-500 hover:text-red-700 hover:bg-red-50">
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
        {users.length === 0 && (
          <div className="p-4 text-center text-slate-500">No users found.</div>
        )}
      </div>

      <ConfirmDialog
        isOpen={userToDelete !== null}
        onOpenChange={(open) => !open && setUserToDelete(null)}
        title="Remove User?"
        description={`Are you sure you want to remove this user? They will lose all access.`}
        confirmText="Remove"
        destructive={true}
        onConfirm={confirmDeleteUser}
      />
    </div>
  );
}
