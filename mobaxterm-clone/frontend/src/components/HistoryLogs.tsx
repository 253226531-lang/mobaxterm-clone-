import { useState, useEffect } from 'react';
import { GetCommandLogs, ClearCommandLogs } from '../../wailsjs/go/main/App';
import { Search, Trash2, Clock, Monitor, Terminal as TermIcon, RotateCcw, Copy, Check } from 'lucide-react';

export default function HistoryLogs() {
    const [logs, setLogs] = useState<any[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [loading, setLoading] = useState(false);
    const [copiedId, setCopiedId] = useState<number | null>(null);

    const fetchLogs = async () => {
        setLoading(true);
        try {
            const data = await GetCommandLogs(searchQuery, 100);
            setLogs(data || []);
        } catch (err) {
            console.error("Failed to fetch logs:", err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        const timer = setTimeout(fetchLogs, 300);
        return () => clearTimeout(timer);
    }, [searchQuery]);

    const handleClear = async () => {
        if (window.confirm("确定要清空所有命令审计日志吗？此操作不可撤销。")) {
            await ClearCommandLogs();
            fetchLogs();
        }
    };

    const copyToClipboard = (text: string, id: number) => {
        navigator.clipboard.writeText(text);
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
    };

    return (
        <div className="flex flex-col h-full bg-[#0D1117] text-[#C9D1D9]">
            {/* Header */}
            <div className="p-4 border-b border-[#30363D] flex items-center justify-between bg-[#161B22]/50">
                <div className="flex items-center gap-2">
                    <Clock size={16} className="text-[#388BFD]" />
                    <h2 className="text-sm font-bold uppercase tracking-wider">命令审计日志</h2>
                </div>
                <button
                    onClick={handleClear}
                    className="p-1.5 text-[#6E7681] hover:text-[#F85149] hover:bg-[#F85149]/10 rounded transition-all"
                    title="清空日志"
                >
                    <Trash2 size={16} />
                </button>
            </div>

            {/* Search Bar */}
            <div className="p-3">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#484F58]" size={14} />
                    <input
                        type="text"
                        placeholder="搜索命令、会话或主机..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full bg-[#161B22] border border-[#30363D] rounded-md pl-9 pr-3 py-1.5 text-xs focus:outline-none focus:border-[#388BFD] transition-all"
                    />
                    {loading && (
                        <div className="absolute right-3 top-1/2 -translate-y-1/2">
                            <RotateCcw size={12} className="animate-spin text-[#388BFD]" />
                        </div>
                    )}
                </div>
            </div>

            {/* Logs List */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-2">
                {logs.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-[#484F58] gap-2 opacity-60">
                        <TermIcon size={32} />
                        <p className="text-xs">暂无命令记录</p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {logs.map((log) => (
                            <div
                                key={log.id}
                                className="group p-3 rounded-lg bg-[#161B22] border border-[#30363D] hover:border-[#484F58] transition-all"
                            >
                                <div className="flex items-start justify-between mb-2">
                                    <div className="flex flex-col gap-1">
                                        <div className="flex items-center gap-2">
                                            <span className="text-[10px] font-bold text-[#388BFD] px-1.5 py-0.5 bg-[#388BFD]/10 rounded uppercase">
                                                {log.protocol}
                                            </span>
                                            <span className="text-[11px] font-medium text-[#8B949E] truncate max-w-[150px]">
                                                {log.sessionName || "未命名会话"}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-1.5 text-[10px] text-[#484F58]">
                                            <Monitor size={10} />
                                            <span>{log.host || "Local/Unknown"}</span>
                                            <span className="mx-1">•</span>
                                            <Clock size={10} />
                                            <span>{log.timestamp}</span>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => copyToClipboard(log.command, log.id)}
                                        className="text-[#6E7681] hover:text-[#C9D1D9] p-1 rounded transition-colors"
                                        title="复制代码"
                                    >
                                        {copiedId === log.id ? <Check size={14} className="text-[#3FB950]" /> : <Copy size={14} />}
                                    </button>
                                </div>
                                <div className="font-mono text-[12px] text-[#C9D1D9] bg-[#0D1117] p-2 rounded border border-[#30363D]/50 break-all leading-relaxed relative overflow-hidden group">
                                    {log.command}
                                    <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-[#0D1117] to-transparent pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity" />
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
            
            <div className="p-3 border-t border-[#30363D] bg-[#161B22]/30 text-center">
                <p className="text-[10px] text-[#484F58]">显示最近 {logs.length} 条记录</p>
            </div>
        </div>
    );
}
