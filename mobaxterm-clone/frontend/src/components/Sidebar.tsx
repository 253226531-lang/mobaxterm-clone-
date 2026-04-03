import React, { useState, useEffect, useCallback } from 'react';
import { Terminal, FolderGit2, BookOpen, Plus, Settings2, Trash2, Wifi, Cable, History, Globe, FolderPlus, Folder, FolderOpen } from 'lucide-react';
import { Tab } from '../types';
import SFTPBrowser from './SFTPBrowser';
import KBSearch from './KBSearch';
import HistoryLogs from './HistoryLogs';
import TFTPServer from './TFTPServer';
import MacroManager from './MacroManager';
import { GetAllSessions, DeleteSession, GetAllSessionGroups, SaveSessionGroup } from '../../wailsjs/go/main/App';

interface SavedSession {
    id: string;
    name: string;
    protocol: string;
    host?: string;
    port?: number;
    comPort?: string;
    groupId?: string;
}

interface SavedGroup {
    id: string;
    parentId?: string;
    name: string;
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
    width?: number;
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
    const [groups, setGroups] = useState<SavedGroup[]>([]);
    const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

    const loadData = useCallback(async () => {
        try {
            const [sessData, groupData] = await Promise.all([
                GetAllSessions(),
                GetAllSessionGroups()
            ]);
            setSessions(sessData || []);
            setGroups(groupData as any || []);
        } catch (e) {
            console.error('加载会话/分组数据失败:', e);
        }
    }, []);

    useEffect(() => {
        loadData();
    }, [loadData, refreshTrigger]);

    const handleCreateGroup = async () => {
        const title = window.prompt('请输入新建的文件夹名称:');
        if (!title) return;
        try {
            await SaveSessionGroup({
                id: `group-${Date.now()}`,
                name: title,
                parentId: '',
                createdAt: ''
            });
            loadData();
        } catch (e) {
            alert('创建失败: ' + e);
        }
    };

    const toggleGroup = (groupId: string) => {
        setExpandedGroups(prev => ({
            ...prev,
            [groupId]: !prev[groupId]
        }));
    };

    // E2 Fix: Use stable function references to avoid closure traps
    const handleDeleteSessionRef = React.useRef(async (id: string) => {
        try {
            await DeleteSession(id);
            loadData();
        } catch (e) {
            console.error('删除会话失败:', e);
        }
    });

    const handleDelete = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        handleDeleteSessionRef.current(id);
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
        <aside
            className="flex flex-col h-full bg-[#161B22] border-r border-[#30363D] shrink-0 overflow-hidden relative"
            style={{ width: 'var(--sidebar-width, 260px)' }}
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
                            <div className="flex gap-1.5">
                                <button
                                    onClick={handleCreateGroup}
                                    title="新建目录"
                                    className="p-1 rounded text-[#8B949E] hover:text-white hover:bg-[#30363D] transition-all duration-200"
                                >
                                    <FolderPlus size={14} />
                                </button>
                                <button
                                    onClick={onNewSession}
                                    title="新建会话"
                                    className="flex items-center justify-center p-1 rounded transition-all duration-200 accent-gradient text-white hover:opacity-90 shadow-sm"
                                >
                                    <Plus size={14} />
                                </button>
                            </div>
                        </div>
                        <div className="space-y-1">
                            {sessions.length === 0 && groups.length === 0 && (
                                <div className="text-center text-[11px] text-[#484F58] py-6">
                                    暂无保存的会话
                                </div>
                            )}

                            {/* Render Groups Level */}
                            {groups.map(group => {
                                const groupSessions = sessions.filter(s => s.groupId === group.id);
                                const isExpanded = expandedGroups[group.id];

                                return (
                                    <div key={group.id} className="mb-1">
                                        <div 
                                            onClick={() => toggleGroup(group.id)}
                                            className="px-2 py-1.5 rounded-lg cursor-pointer hover:bg-[#1C2128] flex items-center gap-2 text-[#8B949E] hover:text-[#C9D1D9] transition-all duration-200 select-none"
                                        >
                                            {isExpanded ? <FolderOpen size={14} className="text-[#D29922]" /> : <Folder size={14} className="text-[#D29922]" />}
                                            <span className="text-[12px] font-medium truncate flex-1">{group.name}</span>
                                        </div>
                                        
                                        {isExpanded && (
                                            <div className="ml-4 pl-2 border-l border-[#30363D] flex flex-col gap-0.5 mt-1">
                                                {groupSessions.length === 0 ? (
                                                    <span className="text-[10px] text-[#484F58] py-1 pl-2">空目录</span>
                                                ) : (
                                                    groupSessions.map(session => (
                                                        <div
                                                            key={session.id}
                                                            className="px-2 py-2 text-sm rounded-lg cursor-pointer hover:bg-[#161B22] flex items-center gap-2.5 group transition-all duration-200 border border-transparent hover:border-[#30363D]"
                                                            onClick={() => onConnectSaved(session)}
                                                        >
                                                            <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ background: session.protocol === 'serial' ? 'rgba(210,153,34,0.1)' : 'rgba(56,139,253,0.1)' }}>
                                                                {getProtocolIcon(session.protocol)}
                                                            </div>
                                                            <div className="flex-1 min-w-0">
                                                                <span className="block text-[12px] font-medium text-[#C9D1D9] truncate">{session.name}</span>
                                                                <span className="block text-[9px] text-[#6E7681]">{getProtocolLabel(session)}</span>
                                                            </div>
                                                            <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity duration-200 shrink-0">
                                                                <button
                                                                    onClick={(e) => { e.stopPropagation(); onEditSession(session); }}
                                                                    className="p-1 rounded text-[#484F58] hover:text-[#388BFD]"
                                                                    title="编辑会话"
                                                                >
                                                                    <Settings2 size={12} />
                                                                </button>
                                                                <button
                                                                    onClick={(e) => handleDelete(e, session.id)}
                                                                    className="p-1 rounded text-[#484F58] hover:text-[#F85149]"
                                                                    title="删除会话"
                                                                >
                                                                    <Trash2 size={12} />
                                                                </button>
                                                            </div>
                                                        </div>
                                                    ))
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}

                            {/* Render Root Level Sessions */}
                            {sessions.filter(s => !s.groupId).map(session => (
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
        </aside>
    );
}
