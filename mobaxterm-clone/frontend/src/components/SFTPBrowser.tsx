import { useState, useEffect } from 'react';
import { SFTPListDirectory, SFTPDownload, SFTPUpload, SFTPDelete, OpenFileDialog, OpenSaveDialog, OpenFolderDialog } from '../../wailsjs/go/main/App';
import { connection } from '../../wailsjs/go/models';
import { Folder, File, ArrowUpCircle, ArrowDownCircle, RefreshCw, ChevronUp, Download, Upload, Trash2 } from 'lucide-react';

interface SFTPBrowserProps {
    sessionId: string | null;
}

export default function SFTPBrowser({ sessionId }: SFTPBrowserProps) {
    const [currentPath, setCurrentPath] = useState<string>('/');
    const [files, setFiles] = useState<connection.FileInfo[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const loadDirectory = async (path: string) => {
        if (!sessionId) return;
        setLoading(true);
        setError(null);
        try {
            const result = await SFTPListDirectory(sessionId, path);
            // Sort: Directories first, then alphabetically
            const sorted = (result || []).sort((a, b) => {
                if (a.isDir && !b.isDir) return -1;
                if (!a.isDir && b.isDir) return 1;
                return a.name.localeCompare(b.name);
            });
            setFiles(sorted);
            setCurrentPath(path);
        } catch (err: any) {
            setError(err.toString());
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (sessionId) {
            loadDirectory('/');
        } else {
            setFiles([]);
            setCurrentPath('/');
        }
    }, [sessionId]);

    const handleDoubleClick = (file: connection.FileInfo) => {
        if (file.isDir) {
            let newPath = currentPath;
            if (newPath === '/') {
                newPath = `/${file.name}`;
            } else {
                newPath = `${newPath}/${file.name}`;
            }
            loadDirectory(newPath);
        }
    };

    const handleLevelUp = () => {
        if (currentPath === '/') return;
        const parts = currentPath.split('/').filter(p => p !== '');
        parts.pop();
        const newPath = '/' + (parts.join('/') || '');
        loadDirectory(newPath === '' ? '/' : newPath);
    };

    const handleUpload = async () => {
        if (!sessionId) return;
        try {
            const localPath = await OpenFileDialog();
            if (!localPath) return;

            setLoading(true);
            const fileName = localPath.split(/[\\/]/).pop();
            const remotePath = currentPath === '/' ? `/${fileName}` : `${currentPath}/${fileName}`;

            await SFTPUpload(sessionId, localPath, remotePath);
            await loadDirectory(currentPath);
        } catch (err: any) {
            setError("上传失败: " + err.toString());
        } finally {
            setLoading(false);
        }
    };

    const handleUploadFolder = async () => {
        if (!sessionId) return;
        try {
            const localPath = await OpenFolderDialog();
            if (!localPath) return;

            setLoading(true);
            const folderName = localPath.split(/[\\/]/).pop();
            const remotePath = currentPath === '/' ? `/${folderName}` : `${currentPath}/${folderName}`;

            await SFTPUpload(sessionId, localPath, remotePath);
            await loadDirectory(currentPath);
        } catch (err: any) {
            setError("上传文件夹失败: " + err.toString());
        } finally {
            setLoading(false);
        }
    };

    const handleDownload = async (file: connection.FileInfo) => {
        if (!sessionId || file.isDir) return;
        try {
            const savePath = await OpenSaveDialog(file.name);
            if (!savePath) return;

            setLoading(true);
            const remotePath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;

            await SFTPDownload(sessionId, remotePath, savePath);
        } catch (err: any) {
            setError("下载失败: " + err.toString());
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (file: connection.FileInfo) => {
        if (!sessionId) return;
        if (!confirm(`确定要删除 ${file.isDir ? '目录' : '文件'} "${file.name}" 吗？`)) return;

        try {
            setLoading(true);
            const remotePath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
            await SFTPDelete(sessionId, remotePath, file.isDir);
            await loadDirectory(currentPath);
        } catch (err: any) {
            setError("删除失败: " + err.toString());
        } finally {
            setLoading(false);
        }
    };

    const formatSize = (bytes: number) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    if (!sessionId) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-500 text-sm p-8 text-center bg-[#0D1117]">
                <div className="w-16 h-16 rounded-full bg-[#161B22] flex items-center justify-center mb-4 border border-[#30363D]">
                    <Folder size={32} className="text-[#30363D]" />
                </div>
                <p className="font-medium text-[#8B949E]">未连接 SSH 会话</p>
                <p className="text-[11px] mt-1 text-[#484F58]">连接 SSH 后即可在此浏览和管理远程文件</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-[#0D1117] text-[#C9D1D9] text-sm overflow-hidden border-t border-[#30363D]">
            {/* Header */}
            <div className="px-3 py-2 bg-[#161B22] border-b border-[#30363D] flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                    <Folder size={14} className="text-[#388BFD]" />
                    <span className="text-[11px] font-bold uppercase tracking-wider text-[#8B949E]">SFTP 浏览器</span>
                </div>
                <div className="flex items-center gap-1">
                    <button
                        onClick={handleUpload}
                        className="p-1.5 hover:bg-[#388BFD]/10 text-[#388BFD] rounded transition-colors group"
                        title="上传文件 (Local -> Remote)"
                    >
                        <Upload size={14} className="group-hover:scale-110 transition-transform" />
                    </button>
                    <button
                        onClick={handleUploadFolder}
                        className="p-1.5 hover:bg-[#388BFD]/10 text-[#388BFD] rounded transition-colors group"
                        title="上传文件夹 (Local -> Remote)"
                    >
                        <Folder size={14} className="group-hover:scale-110 transition-transform" />
                    </button>
                    <button
                        onClick={() => loadDirectory(currentPath)}
                        className="p-1.5 hover:bg-[#238636]/10 text-[#238636] rounded transition-colors group"
                        title="刷新列表"
                    >
                        <RefreshCw size={14} className={`group-hover:rotate-180 transition-transform duration-500 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                </div>
            </div>

            {/* Path Bar */}
            <div className="px-2 py-1.5 bg-[#0D1117] border-b border-[#30363D] flex items-center gap-2 shrink-0">
                <button onClick={handleLevelUp} disabled={currentPath === '/'} className="p-1 hover:bg-[#161B22] rounded disabled:opacity-30 text-[#8B949E] transition-colors">
                    <ChevronUp size={16} />
                </button>
                <div className="flex-1 flex items-center bg-[#161B22] border border-[#30363D] rounded px-2 py-0.5 group focus-within:border-[#388BFD] transition-colors">
                    <span className="text-[10px] text-[#484F58] mr-1 select-none">PATH:</span>
                    <input
                        type="text"
                        value={currentPath}
                        onChange={(e) => setCurrentPath(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && loadDirectory(currentPath)}
                        className="flex-1 bg-transparent border-none p-0 text-[11px] text-[#C9D1D9] focus:outline-none"
                    />
                </div>
            </div>

            {error && (
                <div className="m-2 p-2 text-[11px] text-[#F85149] bg-[#F85149]/10 border border-[#F85149]/20 rounded flex gap-2 items-start animate-fade-in">
                    <div className="mt-0.5 shrink-0">⚠️</div>
                    <div className="flex-1 overflow-hidden break-words">{error}</div>
                </div>
            )}

            {/* File List */}
            <div className="flex-1 overflow-y-auto custom-scrollbar relative">
                {loading && (
                    <div className="absolute inset-x-0 top-0 h-0.5 bg-[#388BFD] animate-[loading-bar_1.5s_infinite] z-20" />
                )}

                <table className="w-full text-left border-collapse select-none table-fixed">
                    <thead className="sticky top-0 bg-[#0D1117] z-10 shadow-sm">
                        <tr className="border-b border-[#30363D]">
                            <th className="px-3 py-2 font-semibold text-[10px] text-[#484F58] uppercase tracking-wider w-full">名称</th>
                            <th className="px-3 py-2 font-semibold text-[10px] text-[#484F58] uppercase tracking-wider text-right w-24">大小</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[#161B22]">
                        {files.length === 0 && !loading && (
                            <tr>
                                <td colSpan={2} className="py-12 text-center text-[#484F58] text-[11px]">
                                    空目录或无法读取
                                </td>
                            </tr>
                        )}
                        {files.map((file, idx) => (
                            <tr
                                key={idx}
                                onDoubleClick={() => handleDoubleClick(file)}
                                className="group/row hover:bg-[#161B22] transition-colors cursor-default"
                            >
                                <td className="px-3 py-2 flex items-center justify-between overflow-hidden">
                                    <div className="flex items-center gap-2 min-w-0 pr-2">
                                        {file.isDir ? (
                                            <Folder size={14} className="text-[#D29922] shrink-0" fill="currentColor" fillOpacity={0.2} />
                                        ) : (
                                            <File size={14} className="text-[#8B949E] shrink-0" />
                                        )}
                                        <span className={`truncate text-[12px] ${file.isDir ? 'text-[#C9D1D9] font-medium' : 'text-[#8B949E]'}`}>
                                            {file.name}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-1 opacity-0 group-hover/row:opacity-100 transition-all duration-200 shrink-0">
                                        {!file.isDir && (
                                            <button
                                                onClick={(e) => { e.stopPropagation(); handleDownload(file); }}
                                                className="p-1 rounded text-[#8B949E] hover:text-[#388BFD] hover:bg-[#388BFD]/10"
                                                title="下载到本地"
                                            >
                                                <Download size={14} />
                                            </button>
                                        )}
                                        <button
                                            onClick={(e) => { e.stopPropagation(); handleDelete(file); }}
                                            className="p-1 rounded text-[#8B949E] hover:text-[#F85149] hover:bg-[#F85149]/10"
                                            title="删除"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                </td>
                                <td className="px-3 py-2 text-right text-[10px] text-[#484F58] whitespace-nowrap font-mono">
                                    {!file.isDir ? formatSize(file.size) : ''}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
