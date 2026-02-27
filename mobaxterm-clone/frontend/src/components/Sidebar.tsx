import { useState, useEffect, useCallback } from 'react';
import { Terminal, FolderGit2, BookOpen, Plus, Settings2, Trash2, Wifi, Cable, History, Globe } from 'lucide-react';
import SFTPBrowser from './SFTPBrowser';
import KBSearch from './KBSearch';
import HistoryLogs from './HistoryLogs';
import TFTPServer from './TFTPServer';
import MacroManager from './MacroManager';
import { GetAllSessions, DeleteSession } from '../../wailsjs/go/main/App';

interface SavedSession {
    id: string;
    name: string;
    protocol: string;
    host?: string;
    port?: number;
    comPort?: string;
}

interface SidebarProps {
    onSessionSelect: (sessionId: string) => void;
    onNewSession: () => void;
    onOpenAdmin: () => void;
    activeSession: string | null;
    onConnectSaved: (session: any) => void;
    onEditSession: (session: any) => void;
    refreshTrigger: number;
    activeSessionId?: string | null;
    width: number;
}

const tabItems = [
    { key: 'sessions' as const, icon: Terminal, label: '会话' },
    { key: 'sftp' as const, icon: FolderGit2, label: 'SFTP' },
    { key: 'kb' as const, icon: BookOpen, label: '知识库' },
    { key: 'macros' as const, icon: Cable, label: '宏' },
    { key: 'logs' as const, icon: History, label: '日志' },
    { key: 'tftp' as const, icon: Globe, label: 'TFTP' },
];

export default function Sidebar({
    onSessionSelect,
    onNewSession,
    onOpenAdmin,
    activeSession,
    onConnectSaved,
    onEditSession,
    refreshTrigger,
    activeSessionId,
    width
}: SidebarProps) {
    const [activeTab, setActiveTab] = useState<'sessions' | 'sftp' | 'kb' | 'macros' | 'logs' | 'tftp'>('sessions');
    const [sessions, setSessions] = useState<SavedSession[]>([]);

    const loadSessions = useCallback(async () => {
        try {
            const data = await GetAllSessions();
            setSessions(data || []);
        } catch (e) {
            console.error('加载会话列表失败:', e);
        }
    }, []);

    useEffect(() => {
        loadSessions();
    }, [loadSessions, refreshTrigger]);

    const handleDelete = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        try {
            await DeleteSession(id);
            loadSessions();
        } catch (e) {
            console.error('删除会话失败:', e);
        }
    };

    const getProtocolIcon = (protocol: string) => {
        if (protocol === 'serial') return <Cable size={14} className="text-[#D29922]" />;
        return <Wifi size={14} className="text-[#388BFD]" />;
    };

    const getProtocolLabel = (session: SavedSession) => {
        if (session.protocol === 'serial') return `串口 · ${session.comPort || ''}`;
        return `${session.protocol.toUpperCase()} · ${session.host || ''}:${session.port || ''}`;
    };

    return (
        <div
            className="h-full flex flex-col shrink-0"
            style={{
                width: `${width}px`,
                background: '#0D1117',
                borderRight: '1px solid rgba(48,54,61,0.6)'
            }}
        >
            {/* Tab Bar */}
            <div className="flex shrink-0" style={{ background: '#161B22' }}>
                {tabItems.map(({ key, icon: Icon, label }) => (
                    <button
                        key={key}
                        onClick={() => setActiveTab(key)}
                        className={`flex-1 py-2.5 flex flex-col items-center gap-0.5 transition-all duration-200 relative
                            ${activeTab === key ? 'text-[#388BFD]' : 'text-[#6E7681] hover:text-[#8B949E]'}`}
                    >
                        <Icon size={16} strokeWidth={activeTab === key ? 2.2 : 1.8} />
                        <span className="text-[10px] font-medium">{label}</span>
                        {activeTab === key && (
                            <div className="absolute bottom-0 left-1/4 right-1/4 h-[2px] rounded-full accent-gradient" />
                        )}
                    </button>
                ))}
            </div>

            {/* Tab Content */}
            <div className="flex-1 overflow-y-auto p-3">
                {activeTab === 'sessions' && (
                    <div className="animate-fade-in">
                        <div className="flex justify-between items-center mb-3">
                            <h3 className="text-[11px] font-semibold text-[#8B949E] uppercase tracking-wider">已保存会话</h3>
                            <button
                                onClick={onNewSession}
                                className="flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-md transition-all duration-200 accent-gradient text-white hover:opacity-90 shadow-sm"
                            >
                                <Plus size={12} />
                                新建
                            </button>
                        </div>
                        <div className="space-y-1">
                            {sessions.length === 0 && (
                                <div className="text-center text-[11px] text-[#484F58] py-6">
                                    暂无保存的会话
                                </div>
                            )}
                            {sessions.map(session => (
                                <div
                                    key={session.id}
                                    className="px-3 py-2.5 text-sm rounded-lg cursor-pointer hover:bg-[#161B22] flex items-center gap-2.5 group transition-all duration-200 border border-transparent hover:border-[#30363D]"
                                    onClick={() => onConnectSaved(session)}
                                >
                                    <div className="w-7 h-7 rounded-md flex items-center justify-center shrink-0" style={{ background: session.protocol === 'serial' ? 'rgba(210,153,34,0.1)' : 'rgba(56,139,253,0.1)' }}>
                                        {getProtocolIcon(session.protocol)}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <span className="block text-[13px] font-medium text-[#C9D1D9] truncate">{session.name}</span>
                                        <span className="block text-[10px] text-[#6E7681]">{getProtocolLabel(session)}</span>
                                    </div>
                                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all duration-200 shrink-0">
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onEditSession(session);
                                            }}
                                            className="p-1 rounded text-[#484F58] hover:text-[#388BFD] hover:bg-[#388BFD]/10 transition-all duration-200"
                                            title="编辑会话"
                                        >
                                            <Settings2 size={12} />
                                        </button>
                                        <button
                                            onClick={(e) => handleDelete(e, session.id)}
                                            className="p-1 rounded text-[#484F58] hover:text-[#F85149] hover:bg-[#DA3633]/10 transition-all duration-200"
                                            title="删除会话"
                                        >
                                            <Trash2 size={12} />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {activeTab === 'sftp' && (
                    <div className="h-full w-full animate-fade-in">
                        <SFTPBrowser sessionId={activeSession} />
                    </div>
                )}

                {activeTab === 'kb' && (
                    <div className="h-full animate-fade-in">
                        <KBSearch activeSessionId={activeSessionId} />
                    </div>
                )}

                {activeTab === 'macros' && (
                    <div className="h-full animate-fade-in">
                        <MacroManager activeSessionId={activeSessionId} />
                    </div>
                )}

                {activeTab === 'logs' && (
                    <div className="h-full animate-fade-in">
                        <HistoryLogs />
                    </div>
                )}

                {activeTab === 'tftp' && (
                    <div className="h-full animate-fade-in overflow-hidden">
                        <TFTPServer />
                    </div>
                )}
            </div>

            {/* Bottom Bar */}
            {activeTab === 'kb' && (
                <div className="p-3 shrink-0" style={{ borderTop: '1px solid rgba(48,54,61,0.6)' }}>
                    <button
                        onClick={onOpenAdmin}
                        className="w-full py-2 rounded-lg text-[12px] font-medium flex items-center justify-center gap-2 transition-all duration-200 text-[#8B949E] hover:text-[#C9D1D9] border border-[#30363D] hover:border-[#6E7681] hover:bg-[#161B22]"
                    >
                        <Settings2 size={14} />
                        管理知识库
                    </button>
                </div>
            )}
        </div>
    );
}
