import { useState, useEffect, useMemo, Fragment, useRef } from 'react';
import {
    SFTPListDirectory, SFTPDownload, SFTPUpload, SFTPDelete, SFTPRename,
    SFTPMkdir, SyncTerminalPath, SFTPChmod, SFTPDownloadDir, SFTPUploadDir,
    OpenFileDialog, OpenSaveDialog, OpenDirectoryDialog
} from '../../wailsjs/go/main/App';
import { connection } from '../../wailsjs/go/models';
import {
    Folder, File, ArrowUpCircle, ArrowDownCircle, RefreshCw, ChevronUp,
    Download, Upload, Trash2, Edit3, FolderPlus, Search, Terminal,
    ArrowUpDown, ChevronRight, Eye, EyeOff, ShieldAlert, FolderUp
} from 'lucide-react';

interface SFTPBrowserProps {
    sessionId: string | null;
}

export default function SFTPBrowser({ sessionId }: SFTPBrowserProps) {
    const [currentPath, setCurrentPath] = useState<string>('/');
    const [files, setFiles] = useState<connection.FileInfo[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [sortConfig, setSortConfig] = useState<{ key: keyof connection.FileInfo, direction: 'asc' | 'desc' } | null>({ key: 'name', direction: 'asc' });
    const [showHidden, setShowHidden] = useState(false);
    const [hoverHint, setHoverHint] = useState<string | null>(null);
    const [statusMsg, setStatusMsg] = useState<{ text: string, type: 'info' | 'success' | 'error' } | null>(null);
    const statusTimer = useRef<any>(null);

    const showStatus = (text: string, type: 'info' | 'success' | 'error' = 'info', duration = 3000) => {
        if (statusTimer.current) clearTimeout(statusTimer.current);
        setStatusMsg({ text, type });
        if (duration > 0) {
            statusTimer.current = setTimeout(() => setStatusMsg(null), duration);
        }
    };

    const filteredAndSortedFiles = useMemo(() => {
        let result = files.filter(f => {
            const matchesSearch = f.name.toLowerCase().includes(searchQuery.toLowerCase());
            const isHidden = f.name.startsWith('.');
            return matchesSearch && (showHidden || !isHidden);
        });

        if (sortConfig) {
            result.sort((a, b) => {
                // Always keep directories first if specified, otherwise sort normally
                if (a.isDir && !b.isDir) return -1;
                if (!a.isDir && b.isDir) return 1;

                const aValue = a[sortConfig.key];
                const bValue = b[sortConfig.key];

                if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
                if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
                return 0;
            });
        }
        return result;
    }, [files, searchQuery, sortConfig]);

    const requestSort = (key: keyof connection.FileInfo) => {
        let direction: 'asc' | 'desc' = 'asc';
        if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    const loadDirectory = async (path: string) => {
        if (!sessionId) return;
        setLoading(true);
        setError(null);
        try {
            const result = await SFTPListDirectory(sessionId, path);
            setFiles(result || []);
            setCurrentPath(path);
        } catch (err: any) {
            setError(err.toString());
        } finally {
            setLoading(false);
            showStatus(`已加载目录: ${path === '/' ? '根目录' : path.split('/').pop()}`, 'info');
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
            showStatus("上传完成", 'success');
        }
    };

    const handleUploadDir = async () => {
        if (!sessionId) return;
        try {
            const localPath = await OpenDirectoryDialog();
            if (!localPath) return;

            showStatus(`正在上传目录: ${localPath.split(/[\\/]/).pop()}...`, 'info', 0);
            setLoading(true);
            const dirName = localPath.split(/[\\/]/).pop();
            const remotePath = currentPath === '/' ? `/${dirName}` : `${currentPath}/${dirName}`;

            await SFTPUploadDir(sessionId, localPath, remotePath);
            await loadDirectory(currentPath);
        } catch (err: any) {
            setError("目录上传失败: " + err.toString());
        } finally {
            setLoading(false);
            showStatus("目录上传完成", 'success');
        }
    };

    const handleDownload = async (file: connection.FileInfo) => {
        if (!sessionId) return;
        try {
            if (file.isDir) {
                const savePath = await OpenDirectoryDialog();
                if (!savePath) return;
                setLoading(true);
                const remotePath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
                await SFTPDownloadDir(sessionId, remotePath, savePath);
            } else {
                const savePath = await OpenSaveDialog(file.name);
                if (!savePath) return;
                setLoading(true);
                const remotePath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
                await SFTPDownload(sessionId, remotePath, savePath);
            }
        } catch (err: any) {
            setError("下载失败: " + err.toString());
        } finally {
            setLoading(false);
            showStatus("下载完成", 'success');
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
            showStatus("删除成功", 'success');
        }
    };

    const handleRename = async (file: connection.FileInfo) => {
        if (!sessionId) return;
        const newName = prompt(`请输入 "${file.name}" 的新名称:`, file.name);
        if (!newName || newName === file.name) return;

        try {
            setLoading(true);
            const oldPath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
            const newPath = currentPath === '/' ? `/${newName}` : `${currentPath}/${newName}`;
            await SFTPRename(sessionId, oldPath, newPath);
            await loadDirectory(currentPath);
        } catch (err: any) {
            setError("重命名失败: " + err.toString());
        } finally {
            setLoading(false);
            showStatus("重命名成功", 'success');
        }
    };

    const handleMkdir = async () => {
        if (!sessionId) return;
        const dirName = prompt("请输入新文件夹名称:");
        if (!dirName) return;

        try {
            setLoading(true);
            const dirPath = currentPath === '/' ? `/${dirName}` : `${currentPath}/${dirName}`;
            await SFTPMkdir(sessionId, dirPath);
            await loadDirectory(currentPath);
        } catch (err: any) {
            setError("创建失败: " + err.toString());
        } finally {
            setLoading(false);
            showStatus("文件夹创建成功", 'success');
        }
    };

    const handleSyncTerminal = async () => {
        if (!sessionId) return;
        try {
            await SyncTerminalPath(sessionId, currentPath);
        } catch (err: any) {
            setError("同步失败: " + err.toString());
        }
    };

    const handleChmod = async (file: connection.FileInfo) => {
        if (!sessionId) return;
        const currentMode = file.mode ? file.mode.substring(file.mode.length - 3) : "644";
        const newMode = prompt(`修改 "${file.name}" 权限 (8进制，如 755):`, currentMode);
        if (!newMode || newMode === currentMode) return;

        try {
            setLoading(true);
            const remotePath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
            await SFTPChmod(sessionId, remotePath, newMode);
            await loadDirectory(currentPath);
        } catch (err: any) {
            setError("权限修改失败: " + err.toString());
        } finally {
            setLoading(false);
            showStatus("权限修改成功", 'success');
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
                        onClick={() => setShowHidden(!showHidden)}
                        onMouseEnter={() => setHoverHint(showHidden ? "默认显示" : "显示全部文件（包括隐藏文件）")}
                        onMouseLeave={() => setHoverHint(null)}
                        className={`p-1.5 rounded transition-colors group ${showHidden ? 'bg-[#388BFD]/10 text-[#388BFD]' : 'hover:bg-[#8B949E]/10 text-[#8B949E]'}`}
                        title={showHidden ? "隐藏以 . 开头的文件" : "显示隐藏文件"}
                    >
                        {showHidden ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                    <button
                        onClick={handleMkdir}
                        onMouseEnter={() => setHoverHint("在当前位置创建一个新文件夹")}
                        onMouseLeave={() => setHoverHint(null)}
                        className="p-1.5 hover:bg-[#238636]/10 text-[#238636] rounded transition-colors group"
                        title="新建文件夹"
                    >
                        <FolderPlus size={14} className="group-hover:scale-110 transition-transform" />
                    </button>
                    <button
                        onClick={handleSyncTerminal}
                        onMouseEnter={() => setHoverHint("让终端 'cd' 到当前 SFTP 路径")}
                        onMouseLeave={() => setHoverHint(null)}
                        className="p-1.5 hover:bg-[#388BFD]/10 text-[#388BFD] rounded transition-colors group"
                        title="同步到终端 (cd 到此目录)"
                    >
                        <Terminal size={14} className="group-hover:scale-110 transition-transform" />
                    </button>
                    <button
                        onClick={handleUpload}
                        onMouseEnter={() => setHoverHint("从本地选择单个文件上传")}
                        onMouseLeave={() => setHoverHint(null)}
                        className="p-1.5 hover:bg-[#388BFD]/10 text-[#388BFD] rounded transition-colors group"
                        title="上传文件 (Local -> Remote)"
                    >
                        <Upload size={14} className="group-hover:scale-110 transition-transform" />
                    </button>
                    <button
                        onClick={handleUploadDir}
                        onMouseEnter={() => setHoverHint("从本地选择整个文件夹递归上传")}
                        onMouseLeave={() => setHoverHint(null)}
                        className="p-1.5 hover:bg-[#388BFD]/10 text-[#388BFD] rounded transition-colors group"
                        title="上传整个文件夹"
                    >
                        <FolderUp size={14} className="group-hover:scale-110 transition-transform" />
                    </button>
                    <button
                        onClick={() => loadDirectory(currentPath)}
                        onMouseEnter={() => setHoverHint("重新加载当前目录的文件列表")}
                        onMouseLeave={() => setHoverHint(null)}
                        className="p-1.5 hover:bg-[#238636]/10 text-[#238636] rounded transition-colors group"
                        title="刷新列表"
                    >
                        <RefreshCw size={14} className={`group-hover:rotate-180 transition-transform duration-500 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                </div>
            </div>

            {/* Breadcrumbs & Path Bar */}
            <div className="px-2 py-1.5 bg-[#0D1117] border-b border-[#30363D] flex flex-col gap-1.5 shrink-0">
                <div className="flex items-center gap-1 overflow-x-auto custom-scrollbar-h pb-0.5 no-scrollbar">
                    <button
                        onClick={() => loadDirectory('/')}
                        className="shrink-0 p-1 hover:bg-[#161B22] rounded text-[#8B949E] hover:text-[#C9D1D9] transition-colors"
                    >
                        <Folder size={12} />
                    </button>
                    {currentPath !== '/' && currentPath.split('/').filter(Boolean).map((part, i, arr) => {
                        const pathLink = '/' + arr.slice(0, i + 1).join('/');
                        return (
                            <Fragment key={pathLink}>
                                <ChevronRight size={10} className="text-[#484F58] shrink-0" />
                                <button
                                    onClick={() => loadDirectory(pathLink)}
                                    className="shrink-0 px-1 py-0.5 hover:bg-[#161B22] rounded text-[11px] text-[#8B949E] hover:text-[#C9D1D9] transition-colors whitespace-nowrap"
                                >
                                    {part}
                                </button>
                            </Fragment>
                        );
                    })}
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={handleLevelUp} disabled={currentPath === '/'} className="p-1 hover:bg-[#161B22] rounded disabled:opacity-30 text-[#8B949E] transition-colors">
                        <ChevronUp size={16} />
                    </button>
                    <div className="flex-1 flex items-center bg-[#161B22] border border-[#30363D] rounded px-2 py-0.5 group focus-within:border-[#388BFD] transition-colors">
                        <input
                            type="text"
                            value={currentPath}
                            onChange={(e) => setCurrentPath(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && loadDirectory(currentPath)}
                            className="flex-1 bg-transparent border-none p-0 text-[11px] text-[#C9D1D9] focus:outline-none"
                        />
                    </div>
                </div>
            </div>

            {/* Search Bar */}
            <div className="px-2 py-1 bg-[#0D1117] border-b border-[#30363D] flex items-center gap-2 shrink-0">
                <div className="flex-1 flex items-center bg-[#161B22] border border-[#30363D] rounded px-2 py-0.5 group focus-within:border-[#388BFD] transition-colors">
                    <Search size={12} className="text-[#484F58] mr-2" />
                    <input
                        type="text"
                        placeholder="在当前目录过滤..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
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
                            <th
                                className="px-3 py-2 font-semibold text-[10px] text-[#484F58] uppercase tracking-wider w-full cursor-pointer hover:text-[#C9D1D9]"
                                onClick={() => requestSort('name')}
                            >
                                <div className="flex items-center gap-1">
                                    名称 {sortConfig?.key === 'name' && <ArrowUpDown size={10} />}
                                </div>
                            </th>
                            <th
                                className="px-3 py-2 font-semibold text-[10px] text-[#484F58] uppercase tracking-wider text-right w-24 cursor-pointer hover:text-[#C9D1D9]"
                                onClick={() => requestSort('size')}
                            >
                                <div className="flex items-center justify-end gap-1">
                                    大小 {sortConfig?.key === 'size' && <ArrowUpDown size={10} />}
                                </div>
                            </th>
                            <th
                                className="px-3 py-2 font-semibold text-[10px] text-[#484F58] uppercase tracking-wider text-right w-32 cursor-pointer hover:text-[#C9D1D9]"
                                onClick={() => requestSort('modTime')}
                            >
                                <div className="flex items-center justify-end gap-1">
                                    修改时间 {sortConfig?.key === 'modTime' && <ArrowUpDown size={10} />}
                                </div>
                            </th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[#161B22]">
                        {filteredAndSortedFiles.length === 0 && !loading && (
                            <tr>
                                <td colSpan={3} className="py-20 text-center bg-[#0D1117]">
                                    <div className="flex flex-col items-center gap-3 opacity-40">
                                        <div className="w-12 h-12 rounded-full border border-dashed border-[#484F58] flex items-center justify-center">
                                            {searchQuery ? <Search size={20} /> : <Folder size={20} />}
                                        </div>
                                        <p className="text-[11px] text-[#8B949E]">
                                            {searchQuery ? `未找到匹配 "${searchQuery}" 的项` : '该目录为空'}
                                        </p>
                                    </div>
                                </td>
                            </tr>
                        )}
                        {filteredAndSortedFiles.map((file, idx) => (
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
                                        <button
                                            onClick={(e) => { e.stopPropagation(); handleChmod(file); }}
                                            onMouseEnter={() => setHoverHint(`修改 "${file.name}" 的权限 (当前: ${file.mode})`)}
                                            onMouseLeave={() => setHoverHint(null)}
                                            className="p-1 rounded text-[#8B949E] hover:text-[#D29922] hover:bg-[#D29922]/10"
                                            title={`权限: ${file.mode || '未知'}`}
                                        >
                                            <ShieldAlert size={14} />
                                        </button>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); handleRename(file); }}
                                            onMouseEnter={() => setHoverHint(`为 "${file.name}" 重命名`)}
                                            onMouseLeave={() => setHoverHint(null)}
                                            className="p-1 rounded text-[#8B949E] hover:text-[#388BFD] hover:bg-[#388BFD]/10"
                                            title="重命名"
                                        >
                                            <Edit3 size={14} />
                                        </button>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); handleDownload(file); }}
                                            onMouseEnter={() => setHoverHint(file.isDir ? `递归下载目录 "${file.name}"` : `下载文件 "${file.name}" 到本地`)}
                                            onMouseLeave={() => setHoverHint(null)}
                                            className="p-1 rounded text-[#8B949E] hover:text-[#388BFD] hover:bg-[#388BFD]/10"
                                            title={file.isDir ? "下载整个文件夹" : "下载到本地"}
                                        >
                                            <Download size={14} />
                                        </button>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); handleDelete(file); }}
                                            onMouseEnter={() => setHoverHint(`删除远程磁盘上的 "${file.name}"`)}
                                            onMouseLeave={() => setHoverHint(null)}
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
                                <td className="px-3 py-2 text-right text-[10px] text-[#484F58] whitespace-nowrap font-mono">
                                    {new Date(file.modTime).toLocaleString()}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Status Bar */}
            <div className="px-2 py-1 bg-[#161B22] border-t border-[#30363D] flex items-center justify-between shrink-0 text-[10px] select-none">
                <div className="flex items-center gap-3 overflow-hidden">
                    {statusMsg ? (
                        <div className={`flex items-center gap-1.5 whitespace-nowrap animate-fade-in ${statusMsg.type === 'success' ? 'text-[#238636]' : statusMsg.type === 'error' ? 'text-[#F85149]' : 'text-[#388BFD]'}`}>
                            <div className={`w-1 h-1 rounded-full ${statusMsg.type === 'success' ? 'bg-[#238636]' : statusMsg.type === 'error' ? 'bg-[#F85149]' : 'bg-[#388BFD]'} animate-pulse`} />
                            {statusMsg.text}
                        </div>
                    ) : hoverHint ? (
                        <div className="text-[#8B949E] italic truncate animate-fade-in">{hoverHint}</div>
                    ) : (
                        <div className="text-[#484F58]">就绪</div>
                    )}
                </div>
                <div className="flex items-center gap-4 shrink-0 text-[#8B949E] px-2">
                    <div className="flex items-center gap-1">
                        <span className="text-[#484F58]">文件数:</span>
                        <span>{filteredAndSortedFiles.length}</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <span className="text-[#484F58]">当前路径:</span>
                        <span className="max-w-[150px] truncate">{currentPath}</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
