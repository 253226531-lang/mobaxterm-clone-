import { useState, useEffect, useRef, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import TerminalTabs from './components/TerminalTabs';
import SessionModal from './components/SessionModal';
import KBSearch from './components/KBSearch';
import KnowledgeAdmin from './components/KnowledgeAdmin';
import { Connect, SaveSession, CloseSession, GetSessionConfig } from '../wailsjs/go/main/App';
import { EventsOn } from '../wailsjs/runtime/runtime';
import { BookOpen, PanelRightClose } from 'lucide-react';
import './index.css';

interface Tab {
    id: string;
    title: string;
    sessionId: string;
    configId?: string;
}

function App() {
    const [tabs, setTabs] = useState<Tab[]>([]);
    const tabsRef = useRef<Tab[]>([]);
    const inFlightConnectionsRef = useRef<Set<string>>(new Set());
    const [activeTabId, setActiveTabId] = useState<string>('');
    const [activeSession, setActiveSession] = useState<string | null>(null);
    const [editingSession, setEditingSession] = useState<any | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isAdminOpen, setIsAdminOpen] = useState(false);
    const [refreshTrigger, setRefreshTrigger] = useState(0);
    const [showKBPanel, setShowKBPanel] = useState(false);
    const [isSplit, setIsSplit] = useState(false);
    const [rightTabId, setRightTabId] = useState<string | null>(null);
    const [sidebarWidth, setSidebarWidth] = useState(260);
    const [isResizing, setIsResizing] = useState(false);

    const startResizing = useCallback(() => {
        setIsResizing(true);
    }, []);

    const stopResizing = useCallback(() => {
        setIsResizing(false);
    }, []);

    const resize = useCallback((mouseMoveEvent: MouseEvent) => {
        if (isResizing) {
            const newWidth = mouseMoveEvent.clientX;
            if (newWidth >= 200 && newWidth <= 600) {
                setSidebarWidth(newWidth);
            }
        }
    }, [isResizing]);

    useEffect(() => {
        if (isResizing) {
            window.addEventListener('mousemove', resize);
            window.addEventListener('mouseup', stopResizing);
        } else {
            window.removeEventListener('mousemove', resize);
            window.removeEventListener('mouseup', stopResizing);
        }
        return () => {
            window.removeEventListener('mousemove', resize);
            window.removeEventListener('mouseup', stopResizing);
        };
    }, [isResizing, resize, stopResizing]);

    // Sync ref with state to allow access in handlers without closure issues
    useEffect(() => {
        tabsRef.current = tabs;
    }, [tabs]);

    const handleSessionSelect = (sessionId: string) => {
        setActiveSession(sessionId);
    };

    const connectAndAddTab = async (data: any) => {
        const configId = data.id;

        if (configId) {
            if (inFlightConnectionsRef.current.has(configId)) {
                return;
            }
            const existing = tabsRef.current.find(t => t.configId === configId);
            if (existing) {
                setActiveTabId(existing.id);
                setActiveSession(existing.sessionId);
                return;
            }
            inFlightConnectionsRef.current.add(configId);
        }

        try {
            const sessionId = await Connect(data);
            const newTabId = `tab-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

            const newTab: Tab = {
                id: newTabId,
                title: data.name || data.host || data.comPort,
                sessionId: sessionId,
                configId: configId
            };

            setTabs(prev => [...prev, newTab]);
            setActiveTabId(newTabId);
            setActiveSession(sessionId);
            return sessionId;
        } catch (err) {
            alert("连接失败: " + err);
        } finally {
            if (configId) inFlightConnectionsRef.current.delete(configId);
        }
    };

    const handleSessionSave = async (data: any) => {
        try {
            const isEditing = !!editingSession;
            const sessionConfig = {
                ...data,
                id: isEditing ? editingSession.id : `saved-${Date.now()}`,
            };
            await SaveSession(sessionConfig);
            setRefreshTrigger(prev => prev + 1);

            if (!isEditing) {
                await connectAndAddTab(sessionConfig);
            }

            setEditingSession(null);
            setIsModalOpen(false);
        } catch (err) {
            alert("操作失败: " + err);
        }
    };

    const handleConnectSaved = async (session: any) => {
        try {
            const existingTab = tabsRef.current.find(t => t.configId === session.id);
            if (existingTab) {
                setActiveTabId(existingTab.id);
                setActiveSession(existingTab.sessionId);
                return;
            }
            await connectAndAddTab(session);
        } catch (err) {
            alert("连接失败: " + err);
        }
    };

    const handleCloseTab = (id: string) => {
        const tab = tabs.find(t => t.id === id);
        if (tab) {
            CloseSession(tab.sessionId);
        }
        setTabs(prev => prev.filter(t => t.id !== id));
        if (activeTabId === id) {
            const index = tabs.findIndex(t => t.id === id);
            if (tabs.length > 1) {
                const nextTab = tabs[index + 1] || tabs[index - 1];
                setActiveTabId(nextTab.id);
            } else {
                setActiveTabId('');
            }
        }
        if (rightTabId === id) setRightTabId(null);
    };

    const handleReconnect = async (sessionId: string) => {
        try {
            const config = await GetSessionConfig(sessionId);
            await CloseSession(sessionId);
            const newSessionId = await Connect(config);

            setTabs(prev => prev.map(t =>
                t.sessionId === sessionId ? { ...t, sessionId: newSessionId } : t
            ));

            if (activeSession === sessionId) {
                setActiveSession(newSessionId);
            }
        } catch (err) {
            alert("重新连接失败: " + err);
        }
    };

    useEffect(() => {
        const unsub = EventsOn('request-reconnect', handleReconnect);
        return () => unsub();
    }, []);

    const activeTab = tabs.find(t => t.id === activeTabId);
    const activeBackendSessionId = activeTab?.sessionId || null;

    return (
        <div
            className={`flex h-screen w-screen overflow-hidden bg-[#0D1117] text-[#C9D1D9] font-inter ${isResizing ? 'cursor-col-resize select-none' : ''}`}
        >
            <Sidebar
                width={sidebarWidth}
                onSessionSelect={handleSessionSelect}
                onNewSession={() => {
                    setEditingSession(null);
                    setIsModalOpen(true);
                }}
                onOpenAdmin={() => setIsAdminOpen(true)}
                activeSession={activeBackendSessionId}
                activeSessionId={activeBackendSessionId}
                onConnectSaved={handleConnectSaved}
                onEditSession={(session) => {
                    setEditingSession(session);
                    setIsModalOpen(true);
                }}
                refreshTrigger={refreshTrigger}
            />

            {/* Resizer Handle */}
            <div
                className={`w-[4px] h-full transition-colors duration-200 cursor-col-resize shrink-0 z-20 ${isResizing ? 'bg-[#388BFD]' : 'hover:bg-[#388BFD]/50'}`}
                onMouseDown={startResizing}
                style={{ borderRight: '1px solid rgba(48,54,61,0.2)' }}
            />

            <main className="flex-1 flex flex-col min-w-0 relative">
                <TerminalTabs
                    tabs={tabs}
                    setTabs={setTabs}
                    activeTabId={activeTabId}
                    setActiveTabId={setActiveTabId}
                    onCloseTab={handleCloseTab}
                    isSplit={isSplit}
                    rightTabId={rightTabId}
                    onSetRightTab={setRightTabId}
                />

                {tabs.length > 0 && (
                    <button
                        onClick={() => setShowKBPanel(!showKBPanel)}
                        className={`absolute right-4 top-14 z-10 p-2 rounded-full shadow-lg transition-all duration-300 ${showKBPanel ? 'bg-[#388BFD] text-white' : 'bg-[#161B22] text-[#6E7681] border border-[#30363D] hover:text-[#C9D1D9]'}`}
                        title="知识库快速搜索"
                    >
                        {showKBPanel ? <PanelRightClose size={18} /> : <BookOpen size={18} />}
                    </button>
                )}

                {showKBPanel && tabs.length > 0 && (
                    <div className="absolute top-24 right-4 z-10 w-80 h-[400px] bg-[#161B22] border border-[#30363D] rounded-xl shadow-2xl overflow-hidden animate-fade-in flex flex-col">
                        <div className="p-3 border-b border-[#30363D] flex justify-between items-center bg-[#0D1117]/50">
                            <span className="text-[11px] font-bold text-[#8B949E] uppercase tracking-wider">知识库检索</span>
                            <button onClick={() => setShowKBPanel(false)} className="text-[#6E7681] hover:text-[#C9D1D9]">
                                <PanelRightClose size={14} />
                            </button>
                        </div>
                        <div className="flex-1 overflow-hidden">
                            <KBSearch activeSessionId={activeBackendSessionId} />
                        </div>
                    </div>
                )}
            </main>

            <SessionModal
                isOpen={isModalOpen}
                onClose={() => {
                    setIsModalOpen(false);
                    setEditingSession(null);
                }}
                onSave={handleSessionSave}
                initialData={editingSession}
            />

            {isAdminOpen && (
                <KnowledgeAdmin
                    onClose={() => {
                        setIsAdminOpen(false);
                        setRefreshTrigger(prev => prev + 1);
                    }}
                />
            )}
        </div>
    );
}

export default App;
