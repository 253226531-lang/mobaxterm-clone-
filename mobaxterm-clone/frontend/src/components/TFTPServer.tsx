import React, { useState, useEffect } from 'react';
import { Play, Square, FolderOpen, Activity, Terminal as TermIcon, Trash2, Clock, Globe, Shield, Info, CheckCircle2, AlertCircle, Settings2, History as HistoryIcon } from 'lucide-react';
import { StartTFTPServer, StopTFTPServer, GetTFTPStatus, OpenFolderDialog } from '../../wailsjs/go/main/App';
import { EventsOn, EventsOff } from '../../wailsjs/runtime/runtime';

interface Transfer {
    filename: string;
    remoteAddr: string;
    type: string;
    status: string;
    size: number;
    startTime: string;
}

export default function TFTPServer() {
    const [isRunning, setIsRunning] = useState(false);
    const [rootPath, setRootPath] = useState('');
    const [port, setPort] = useState(69);
    const [transfers, setTransfers] = useState<Transfer[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchStatus = async () => {
            try {
                const status = await GetTFTPStatus();
                setIsRunning(status.isRunning);
                setRootPath(status.rootPath || '');
                setLoading(false);
            } catch (err) {
                console.error("Failed to fetch TFTP status:", err);
                setLoading(false);
            }
        };

        fetchStatus();

        const handleTransfer = (info: Transfer) => {
            setTransfers(prev => [info, ...prev].slice(0, 50));
        };

        EventsOn('tftp-transfer', handleTransfer);
        return () => EventsOff('tftp-transfer');
    }, []);

    const handleStart = async () => {
        if (!rootPath) {
            alert("请先选择根目录");
            return;
        }
        try {
            await StartTFTPServer(rootPath, port);
            const status = await GetTFTPStatus();
            setIsRunning(status.isRunning);
        } catch (err) {
            alert("启动失败: " + err);
        }
    };

    const handleStop = async () => {
        try {
            await StopTFTPServer();
            setIsRunning(false);
        } catch (err) {
            alert("停止失败: " + err);
        }
    };

    const selectDirectory = async () => {
        try {
            const path = await OpenFolderDialog();
            if (path) setRootPath(path);
        } catch (err) {
            console.error("Failed to open directory dialog:", err);
        }
    };

    if (loading) return null;

    return (
        <div className="flex-1 flex flex-col h-full bg-[#0D1117] overflow-hidden border-t border-[#30363D]">
            {/* Header / Stats Summary */}
            <div className="p-3 bg-[#161B22]/50 border-b border-[#30363D] flex justify-between items-center shrink-0">
                <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${isRunning ? 'bg-[#238636] animate-pulse' : 'bg-[#6E7681]'}`} />
                    <span className="text-[11px] font-bold text-[#C9D1D9]">TFTP 服务</span>
                </div>
                <button
                    onClick={isRunning ? handleStop : handleStart}
                    className={`px-2 py-1 rounded text-[10px] font-bold transition-all ${isRunning
                        ? 'bg-[#DA3633]/10 text-[#F85149] hover:bg-[#DA3633]/20 border border-[#DA3633]/30'
                        : 'bg-[#238636] text-white hover:bg-[#2EA043]'
                        }`}
                >
                    {isRunning ? "停止" : "启动"}
                </button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-4">
                {/* Configuration Section */}
                <div className="space-y-3">
                    <div className="flex items-center gap-2 text-[#8B949E]">
                        <Settings2 size={12} />
                        <span className="text-[10px] uppercase font-bold tracking-wider">配置</span>
                    </div>

                    <div className="space-y-2">
                        <div>
                            <label className="block text-[10px] text-[#484F58] mb-1 pl-1">根目录</label>
                            <div className="flex gap-1.5">
                                <div className="flex-1 bg-[#0D1117] border border-[#30363D] rounded px-2 py-1.5 text-[11px] text-[#8B949E] truncate">
                                    {rootPath || "未选择..."}
                                </div>
                                <button
                                    disabled={isRunning}
                                    onClick={selectDirectory}
                                    className="p-1.5 bg-[#21262D] border border-[#30363D] hover:border-[#6E7681] rounded text-[#C9D1D9] transition-colors disabled:opacity-30"
                                >
                                    <FolderOpen size={13} />
                                </button>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                <label className="block text-[10px] text-[#484F58] mb-1 pl-1">端口</label>
                                <input
                                    type="number"
                                    disabled={isRunning}
                                    value={port}
                                    onChange={(e) => setPort(parseInt(e.target.value))}
                                    className="w-full bg-[#0D1117] border border-[#30363D] rounded px-2 py-1 text-[11px] text-[#C9D1D9] focus:outline-none focus:border-[#388BFD] disabled:opacity-30"
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] text-[#484F58] mb-1 pl-1">传输数</label>
                                <div className="w-full bg-[#0D1117] border border-[#30363D] rounded px-2 py-1 text-[11px] text-[#C9D1D9] font-mono">
                                    {transfers.length}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Log Section */}
                <div className="flex-1 flex flex-col min-h-0">
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2 text-[#8B949E]">
                            <HistoryIcon size={12} />
                            <span className="text-[10px] uppercase font-bold tracking-wider">传输动态</span>
                        </div>
                        {transfers.length > 0 && (
                            <button onClick={() => setTransfers([])} className="text-[#484F58] hover:text-[#C9D1D9]">
                                <Trash2 size={11} />
                            </button>
                        )}
                    </div>

                    <div className="bg-[#161B22] border border-[#30363D] rounded-lg overflow-hidden flex-1 min-h-[300px]">
                        {transfers.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center p-4 text-center">
                                <Activity size={20} className="text-[#30363D] mb-2" />
                                <span className="text-[10px] text-[#484F58]">暂无记录</span>
                            </div>
                        ) : (
                            <div className="divide-y divide-[#30363D] overflow-y-auto h-full custom-scrollbar">
                                {transfers.map((t, i) => (
                                    <div key={i} className="p-2 hover:bg-[#21262D] transition-colors group">
                                        <div className="flex justify-between items-start mb-1">
                                            <span className="text-[11px] font-bold text-[#C9D1D9] truncate flex-1 pr-2" title={t.filename}>
                                                {t.filename}
                                            </span>
                                            <span className={`text-[9px] px-1 rounded uppercase font-bold ${t.type === 'READ' ? 'text-[#388BFD] bg-[#388BFD]/10' : 'text-[#238636] bg-[#238636]/10'
                                                }`}>
                                                {t.type === 'READ' ? 'GET' : 'PUT'}
                                            </span>
                                        </div>
                                        <div className="flex justify-between items-center text-[9px] text-[#6E7681]">
                                            <span className="font-mono">{t.remoteAddr}</span>
                                            <span>{t.size > 0 ? (t.size / 1024).toFixed(1) + " KB" : "-"}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
