import React, { useEffect, useRef, useState, memo } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';
import { X, Plus, Terminal as TermIcon, Columns, Layout, Download, Radio, Send, Zap, AlertTriangle, RotateCcw, Trash2, Copy, Clipboard } from 'lucide-react';
import { EventsOn, EventsOff, EventsEmit } from '../../wailsjs/runtime/runtime';
import { WriteTerminal, ResizeTerminal, SaveTerminalLog, WriteMultipleTerminals, GetAllMacros, ExecuteMacro } from '../../wailsjs/go/main/App';
import { db } from '../../wailsjs/go/models';

import { Tab } from '../types';

interface TerminalTabsProps {
    tabs: Tab[];
    setTabs: React.Dispatch<React.SetStateAction<Tab[]>>;
    activeTabId: string | null;
    setActiveTabId: (id: string) => void;
    onCloseTab: (id: string) => void;
    isSplit: boolean;
    rightTabId: string | null;
    onSetRightTab: (id: string | null) => void;
}

const RISKY_PATTERNS = [
    /rm\s+-rf/i,
    /reboot/i,
    /shutdown/i,
    /init\s+[06]/i,
    /halt/i,
    /mkfs/i,
    /fdisk/i,
    /undo\s+interface/i,
    /delete\s+\/force/i,
    /format/i,
    /dd\s+if=/i,
    /systemctl\s+stop/i,
    /killall/i,
    /erase\s+startup-config/i
];

// 预编译正则（模块级）
// 1. 提示符：极致匹配，支持 [~Switch], <*Router>, [SwitchB] 等，甚至包含带空格的提示符
const RE_PROMPT = /([<\[][~*# ]?[\w.-]{1,64}[>\]])/g;
// 2. IP 地址：支持 IPv4, IPv6 (全写, 简写, 占位符 X:X::)
const RE_IP = /\b((?:[0-9]{1,3}\.){3}[0-9]{1,3}|(?:[0-9a-fA-F]{1,4}:){1,7}[0-9a-fA-F]{1,4}|::(?:[0-9a-fA-F]{1,4}:){0,5}[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,4}:){1,7}:|X:X(?::[X:]+)*)\b/gi;
// 3. 数通指令：将长指令和短语分开，确保即便只有部分匹配也能高亮
const RE_NET_CMD = /\b(ip\s+route-static|ipv6\s+route-static|ip\s+address|ipv6\s+address|undo\s+shutdown|display|dis|interface|int|vlan|undo|shutdown|quit|return|save|system-view|sys|protocol|route-static|ospf|bgp|acl|policy-based-route|snmp-agent|user-interface|authentication-mode|ip|ipv6)\b/gi;
const RE_IFACE = /(GigabitEthernet|Ten-GigabitEthernet|X-GigabitEthernet|Ethernet|Vlanif|LoopBack|Eth-Trunk|Serial|Atm|Tunnel|Bridge-if|M-Ethernet|XGE|GE|ME|Vlan-interface|Vlan-interface|VUI)\s*(\d+(?:\/\d+)*(?:\.\d+)?)/gi;
const RE_UP = /\b(up|active|online|connected|passed|UP|Active|Online|Connected)\b/g;
const RE_BAD = /\b(down|error|fail|failed|panic|critical|fatal|offline|shutdown|blocked|deny|failed|DOWN|Error|Fail|Failed|Shutdown)\b/g;
const RE_WARN = /\b(warning|warn|alarm|alert|WARNING|Warn|Alarm|Alert)\b/g;

// 对纯文本片段应用关键字高亮
function applyKeyHighlights(s: string): string {
    if (!s) return s;
    let result = s;
    // 配色方案：36(加粗青)-提示符 | 33(黄)-IP | 32(绿)-接口/成功 | 1;34(加粗蓝)-指令 | 1;31(加粗红)-失败
    result = result.replace(RE_PROMPT, '\x1b[1;36m$1\x1b[0m');
    result = result.replace(RE_IP, '\x1b[33m$1\x1b[0m');
    result = result.replace(RE_IFACE, '\x1b[32m$1 $2\x1b[0m');
    result = result.replace(RE_NET_CMD, '\x1b[1;34m$1\x1b[0m');
    result = result.replace(RE_UP, '\x1b[1;32m$1\x1b[0m');
    result = result.replace(RE_BAD, '\x1b[1;31m$1\x1b[0m');
    result = result.replace(RE_WARN, '\x1b[33m$1\x1b[0m');
    return result;
}

// 极其健壮的 ANSI 拆分正则：涵盖所有 CSI, OSC, G0/G1 charset 开头等
const ANSI_SPLIT_RE = /(\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07|\x1b[()]?[AB]|\x1b.)/g;

// 关键字高亮过滤器
function highlightFilter(text: string): string {
    if (!text || text.length > 8192) return text;
    // 如果没有转义码，直接整体尝试匹配
    if (!text.includes('\x1b')) return applyKeyHighlights(text);

    // 有转义码的情况：按块拆分，保护转义序列，只高亮文本
    const parts = text.split(ANSI_SPLIT_RE);
    for (let i = 0; i < parts.length; i++) {
        // 偶数下标是文本段
        if (i % 2 === 0 && parts[i] && parts[i].length > 0) {
            parts[i] = applyKeyHighlights(parts[i]);
        }
    }
    return parts.join('');
}

const TerminalContextMenu = memo(({ x, y, onClose, onClear, onReconnect, onPaste }: any) => {
    useEffect(() => {
        const handleClick = () => onClose();
        window.addEventListener('click', handleClick);
        return () => window.removeEventListener('click', handleClick);
    }, [onClose]);

    return (
        <div
            className="fixed z-[100] bg-[#161B22] border border-[#30363D] rounded-lg shadow-2xl py-1.5 min-w-[160px] animate-fade-in"
            style={{ left: x, top: y }}
        >
            <button onClick={onClear} className="w-full px-3 py-1.5 text-left text-[12px] text-[#C9D1D9] hover:bg-[#388BFD] hover:text-white flex items-center gap-2 transition-colors">
                <Trash2 size={14} /> 清除屏幕
            </button>
            <button onClick={onReconnect} className="w-full px-3 py-1.5 text-left text-[12px] text-[#C9D1D9] hover:bg-[#388BFD] hover:text-white flex items-center gap-2 transition-colors">
                <RotateCcw size={14} /> 重新连接
            </button>
            <div className="h-[1px] bg-[#30363D] my-1" />
            <button onClick={() => {
                const selection = window.getSelection()?.toString();
                if (selection) navigator.clipboard.writeText(selection);
                onClose();
            }} className="w-full px-3 py-1.5 text-left text-[12px] text-[#C9D1D9] hover:bg-[#388BFD] hover:text-white flex items-center gap-2 transition-colors">
                <Copy size={14} /> 复制
            </button>
            <button onClick={() => {
                onPaste();
                onClose();
            }} className="w-full px-3 py-1.5 text-left text-[12px] text-[#C9D1D9] hover:bg-[#388BFD] hover:text-white flex items-center gap-2 transition-colors">
                <Clipboard size={14} /> 粘贴
            </button>
        </div>
    );
});

export default function TerminalTabs({
    tabs,
    setTabs,
    activeTabId,
    setActiveTabId,
    onCloseTab,
    isSplit,
    rightTabId,
    onSetRightTab
}: TerminalTabsProps) {
    const [secondaryTabId, setSecondaryTabId] = useState<string | null>(null);
    const [showBroadcast, setShowBroadcast] = useState(false);
    const [broadcastInput, setBroadcastInput] = useState('');
    const [riskyCommand, setRiskyCommand] = useState('');
    const [menu, setMenu] = useState<any>(null);
    const [isSafetyModalOpen, setIsSafetyModalOpen] = useState(false);
    const [macros, setMacros] = useState<db.Macro[]>([]);
    const [showMacroList, setShowMacroList] = useState(false);


    const addTab = () => {
        const newId = Date.now().toString();
        // The parent usually handles this, but since we are modifying state here:
        // Actually the user said "audit and optimize", so let's keep the parent logic if possible.
        // But for now let's just fix what's here.
    };

    const closeTab = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        onCloseTab(id);
    };

    const toggleSplit = () => {
        // This is now passed from parent
    };

    const handleTabClick = (id: string, isSecondary: boolean) => {
        if (isSplit && isSecondary) {
            onSetRightTab(id);
        } else {
            setActiveTabId(id);
        }
    };

    const handleSaveLog = () => {
        const activeTab = tabs.find(t => t.id === activeTabId);
        if (activeTab) {
            EventsEmit(`request-save-log-${activeTab.sessionId}`);
        }
    };

    const executeBroadcast = async (command: string) => {
        const sessionIds = tabs.map(t => t.sessionId);
        try {
            await WriteMultipleTerminals(sessionIds, command + "\r");
            setBroadcastInput('');
            setIsSafetyModalOpen(false);
        } catch (err) {
            console.error("Broadcast failed:", err);
        }
    };

    const handleBroadcastSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const cmd = broadcastInput.trim();
        if (!cmd || tabs.length === 0) return;

        const isRisky = RISKY_PATTERNS.some(pattern => pattern.test(cmd));
        if (isRisky) {
            setRiskyCommand(cmd);
            setIsSafetyModalOpen(true);
            return;
        }

        executeBroadcast(cmd);
    };

    const confirmBroadcast = () => {
        executeBroadcast(riskyCommand);
    };

    const loadMacros = async () => {
        try {
            const data = await GetAllMacros();
            setMacros(data || []);
        } catch (e) { }
    };

    useEffect(() => {
        loadMacros();
    }, []);

    const handleExecuteMacro = async (macroId: string) => {
        const activeTab = tabs.find(t => t.id === activeTabId);
        if (activeTab) {
            try {
                await ExecuteMacro(activeTab.sessionId, macroId);
                setShowMacroList(false);
            } catch (e) {
                console.error("Macro execution failed:", e);
            }
        }
    };

    useEffect(() => {
        const handleShowMenu = (e: any) => {
            setMenu(e.detail);
        };
        window.addEventListener('show-terminal-menu', handleShowMenu);
        return () => window.removeEventListener('show-terminal-menu', handleShowMenu);
    }, []);

    return (
        <div className="flex-1 flex flex-col h-full overflow-hidden relative" style={{ background: '#0D1117' }}>
            {/* Tab Bar */}
            {/* Tab Bar Header Container */}
            <div className="flex items-center shrink-0 pr-2 bg-[#161B22] border-b border-[#30363D]/60">
                {/* Scrollable Tabs Part */}
                <div className="flex-1 flex min-w-0 overflow-x-auto no-scrollbar">
                    {tabs.map((tab) => (
                        <div
                            key={tab.id}
                            onClick={() => handleTabClick(tab.id, false)}
                            onContextMenu={(e) => {
                                e.preventDefault();
                                if (isSplit) onSetRightTab(tab.id);
                            }}
                            className={`flex items-center gap-2 px-4 py-2 text-[12px] cursor-pointer min-w-[130px] max-w-[200px] select-none transition-all duration-200 relative group
                                ${activeTabId === tab.id
                                    ? 'text-[#C9D1D9] bg-[#0D1117]'
                                    : rightTabId === tab.id && isSplit
                                        ? 'text-[#388BFD] bg-[#0D1117]/50'
                                        : 'text-[#6E7681] hover:text-[#8B949E] hover:bg-[#1C2128]'
                                }`}
                            style={activeTabId === tab.id ? { borderBottom: 'none' } : { borderRight: '1px solid rgba(48,54,61,0.4)' }}
                        >
                            <TermIcon size={12} className={activeTabId === tab.id ? 'text-[#388BFD]' : rightTabId === tab.id && isSplit ? 'text-[#388BFD]' : 'text-[#484F58]'} />
                            <span className="truncate flex-1 font-medium">{tab.title}</span>
                            <button
                                onClick={(e) => closeTab(e, tab.id)}
                                className={`p-0.5 rounded hover:bg-[#DA3633]/20 hover:text-[#F85149] transition-all duration-200
                                    ${activeTabId === tab.id ? 'opacity-60 hover:opacity-100' : 'opacity-0 group-hover:opacity-60 hover:!opacity-100'}`}
                            >
                                <X size={12} />
                            </button>
                            {activeTabId === tab.id && (
                                <div className="absolute bottom-0 left-0 right-0 h-[2px] accent-gradient" />
                            )}
                            {rightTabId === tab.id && isSplit && activeTabId !== tab.id && (
                                <div className="absolute bottom-0 left-1 right-1 h-[2px] bg-[#388BFD]/40 rounded-full" />
                            )}
                        </div>
                    ))}
                    <Plus size={14} className="mx-3 my-auto text-[#484F58] cursor-not-allowed opacity-50 shrink-0" />
                </div>

                <div className="flex items-center gap-1 px-2 border-l border-[#30363D]">
                    <button
                        onClick={() => setShowBroadcast(!showBroadcast)}
                        className={`p-1.5 rounded-md transition-all duration-200 ${showBroadcast ? 'text-[#388BFD] bg-[#388BFD]/10' : 'text-[#6E7681] hover:text-[#C9D1D9] hover:bg-[#21262D]'}`}
                        title="同步广播"
                    >
                        <Radio size={14} />
                    </button>
                    <button
                        onClick={handleSaveLog}
                        className="p-1.5 rounded-md text-[#6E7681] hover:text-[#C9D1D9] hover:bg-[#21262D] transition-all duration-200"
                        title="保存终端日志"
                    >
                        <Download size={14} />
                    </button>

                    <div className="relative">
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setShowMacroList(!showMacroList);
                                if (!showMacroList) loadMacros();
                            }}
                            className={`p-1.5 rounded-md transition-all duration-200 ${showMacroList ? 'text-[#388BFD] bg-[#388BFD]/10' : 'text-[#6E7681] hover:text-[#C9D1D9] hover:bg-[#21262D]'}`}
                            title="执行宏指令"
                        >
                            <Zap size={14} />
                        </button>

                        {showMacroList && (
                            <div
                                className="absolute right-0 top-full mt-1 w-48 bg-[#161B22] border border-[#30363D] rounded-lg shadow-2xl py-2 z-[70] animate-fade-in"
                                onClick={(e) => e.stopPropagation()} // Prevent closing when clicking inside menu content
                            >
                                <div className="px-3 py-1 text-[10px] font-bold text-[#8B949E] uppercase tracking-wider mb-1 border-b border-[#30363D]/50">可用宏</div>
                                {macros.length === 0 ? (
                                    <div className="px-3 py-2 text-[11px] text-[#484F58]">无可用宏</div>
                                ) : (
                                    macros.map(m => (
                                        <button
                                            key={m.id}
                                            onClick={(e) => {
                                                handleExecuteMacro(m.id);
                                            }}
                                            className="w-full px-3 py-2 text-left text-[12px] text-[#C9D1D9] hover:bg-[#388BFD] hover:text-white transition-colors truncate"
                                        >
                                            {m.name}
                                        </button>
                                    ))
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <div className="flex-1 relative overflow-hidden flex flex-col">
                {tabs.length === 0 ? (
                    <WelcomeScreen />
                ) : (
                    <>
                        <div className={`flex-1 flex relative overflow-hidden ${isSplit ? 'flex-row' : 'flex-col'}`}>
                            <div className={`relative ${isSplit ? 'flex-1' : 'w-full h-full'}`}>
                                {tabs.map((tab) => (
                                    <div
                                        key={`primary-${tab.id}`}
                                        className={`absolute inset-0 ${activeTabId === tab.id ? 'block' : 'hidden'}`}
                                    >
                                        <XTermInstance sessionId={tab.sessionId} isActive={activeTabId === tab.id} />
                                    </div>
                                ))}
                            </div>

                            {isSplit && (
                                <div className="w-[1px] bg-[#30363D] shrink-0" />
                            )}
                            {isSplit && (
                                <div className="flex-1 relative bg-[#0D1117]">
                                    {!rightTabId ? (
                                        <div className="absolute inset-0 flex flex-col items-center justify-center text-[#484F58] gap-2">
                                            <Layout size={32} />
                                            <p className="text-[11px]">右键点击上方标签页以在此分屏显示</p>
                                        </div>
                                    ) : (
                                        tabs.map((tab) => (
                                            <div
                                                key={`secondary-${tab.id}`}
                                                className={`absolute inset-0 ${rightTabId === tab.id ? 'block' : 'hidden'}`}
                                            >
                                                <XTermInstance sessionId={tab.sessionId} isActive={rightTabId === tab.id} />
                                            </div>
                                        ))
                                    )}
                                </div>
                            )}
                        </div>

                        {showBroadcast && (
                            <div className="shrink-0 p-2 bg-[#161B22] border-t border-[#30363D] flex items-center gap-3 animate-slide-up">
                                <div className="flex items-center gap-2 text-[#388BFD] shrink-0">
                                    <Zap size={14} className="animate-pulse" />
                                    <span className="text-[11px] font-bold uppercase tracking-wider">同步广播</span>
                                </div>
                                <form onSubmit={handleBroadcastSubmit} className="flex-1 relative">
                                    <input
                                        type="text"
                                        autoFocus
                                        value={broadcastInput}
                                        onChange={(e) => setBroadcastInput(e.target.value)}
                                        placeholder={`输入命令发送到所有 ${tabs.length} 个终端标签页...`}
                                        className="w-full bg-[#0D1117] border border-[#388BFD]/30 rounded-md px-3 py-1.5 text-[12px] text-[#C9D1D9] focus:outline-none focus:border-[#388BFD] transition-all"
                                    />
                                    <button type="submit" className="absolute right-2 top-1/2 -translate-y-1/2 text-[#388BFD]">
                                        <Send size={14} />
                                    </button>
                                </form>
                            </div>
                        )}
                    </>
                )}
            </div>

            {isSafetyModalOpen && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60] animate-fade-in">
                    <div className="bg-[#161B22] border border-[#F85149]/30 rounded-xl p-6 w-[400px] shadow-2xl">
                        <div className="flex items-center gap-3 text-[#F85149] mb-4">
                            <AlertTriangle size={24} />
                            <h3 className="text-lg font-bold">高危指令拦截</h3>
                        </div>
                        <p className="text-[#8B949E] text-sm mb-6 leading-relaxed">
                            检测到包含高危关键词指令。该操作将同时发送至 <span className="text-white font-mono">{tabs.length}</span> 个终端，可能导致系统故障。请再次确认：
                        </p>
                        <div className="flex justify-end gap-3">
                            <button onClick={() => setIsSafetyModalOpen(false)} className="px-4 py-2 rounded-lg text-sm font-medium text-[#8B949E] border border-[#30363D] hover:border-[#6E7681]">取消发送</button>
                            <button onClick={confirmBroadcast} className="px-5 py-2 rounded-lg text-sm font-medium text-white bg-[#F85149] hover:bg-[#DA3633]">我确认并继续</button>
                        </div>
                    </div>
                </div>
            )}

            {menu && (
                <TerminalContextMenu
                    {...menu}
                    onClose={() => setMenu(null)}
                    onClear={() => { menu.onClear(); setMenu(null); }}
                    onReconnect={() => { menu.onReconnect(); setMenu(null); }}
                />
            )}
        </div>
    );
}

function WelcomeScreen() {
    return (
        <div className="w-full h-full flex flex-col items-center justify-center gap-6 select-none" style={{ background: '#0D1117' }}>
            <div className="animate-float">
                <div className="w-20 h-20 rounded-2xl flex items-center justify-center accent-gradient shadow-lg">
                    <TermIcon size={36} className="text-white" />
                </div>
            </div>
            <div className="text-center px-6">
                <h1 className="text-2xl font-bold accent-gradient-text mb-2">终端管理器 Pro</h1>
                <p className="text-[13px] text-[#8B949E] max-w-xs">点击左侧会话列表以连接到设备。</p>
            </div>
        </div>
    );
}

const XTermInstance = memo(({ sessionId, isActive }: { sessionId: string; isActive: boolean }) => {
    const terminalRef = useRef<HTMLDivElement>(null);
    const xtermRef = useRef<XTerm | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);

    useEffect(() => {
        if (!terminalRef.current) return;

        const term = new XTerm({
            cursorBlink: true,
            allowProposedApi: true,
            scrollback: 5000,
            theme: {
                background: '#0D1117',
                foreground: '#C9D1D9',
                cursor: '#58A6FF',
                selectionBackground: 'rgba(56,139,253,0.3)',
                black: '#484F58',
                red: '#F85149',
                green: '#7EE787',
                yellow: '#D29922',
                blue: '#58A6FF',
                magenta: '#BC8CFF',
                cyan: '#76E3EA',
                white: '#B1BAC4',
            },
            fontFamily: '"Cascadia Code", Consolas, monospace',
            fontSize: 14,
            allowTransparency: true,
        });

        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);

        term.open(terminalRef.current);

        try {
            const webglAddon = new WebglAddon();
            webglAddon.onContextLoss(() => {
                webglAddon.dispose();
            });
            term.loadAddon(webglAddon);
        } catch (e) {
            console.warn('WebGL addon could not be loaded, falling back to canvas renderer', e);
        }

        xtermRef.current = term;
        fitAddonRef.current = fitAddon;

        setTimeout(() => fitAddon.fit(), 100);

        let resizeRafId: number | null = null;
        let resizeTimeout: any = null;

        const resizeObserver = new ResizeObserver(() => {
            if (fitAddonRef.current && xtermRef.current) {
                // 使用 requestAnimationFrame 避免在改变窗口时高频触发重绘堵塞主线程
                if (resizeRafId !== null) cancelAnimationFrame(resizeRafId);
                resizeRafId = requestAnimationFrame(() => {
                    try {
                        fitAddonRef.current?.fit();

                        // 向后端发送新的行列数则继续使用传统的节流，因为没必要跟随拉拽的每一帧发送
                        if (resizeTimeout) clearTimeout(resizeTimeout);
                        resizeTimeout = setTimeout(() => {
                            if (xtermRef.current) {
                                const { cols, rows } = xtermRef.current;
                                ResizeTerminal(sessionId, cols, rows).catch(() => { });
                            }
                        }, 150);
                    } catch (e) { }
                });
            }
        });
        resizeObserver.observe(terminalRef.current);

        // 退格键处理：明确发送 \b (0x08 BS)，与 PTY VERASE=8 对齐
        // 华为/中兴等网络设备的 VRP/VOS 使用 \b 作为退格信号
        term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
            if (event.type === 'keydown' && event.key === 'Backspace'
                && !event.ctrlKey && !event.altKey && !event.metaKey) {
                WriteTerminal(sessionId, '\b').catch(() => { });
                return false; // 阻止 xterm 的 onData 再次发送
            }
            return true;
        });

        term.onData(data => {
            WriteTerminal(sessionId, data).catch(() => { });
        });

        // 智能流式写入策略：
        // 1. 解决串口卡顿：小数据（≤32字节）如果是交互式回显，我们增加一个极短（16ms）的缓冲区
        //    这是为了让正则表达式能够匹配到完整的单词（串口常逐字发送）。
        // 2. 解决大流量性能：大数据走 rAF 批量批量合并写入。
        let writeQueue: string[] = [];
        let rafPending = false;
        const flushQueue = () => {
            if (writeQueue.length === 0) return;
            const chunk = writeQueue.join('');
            writeQueue = [];
            rafPending = false;
            term.write(highlightFilter(chunk));
        };

        let streamBuffer = '';
        let streamTimer: any = null;
        const flushStream = () => {
            if (streamTimer) {
                clearTimeout(streamTimer);
                streamTimer = null;
            }
            if (!streamBuffer) return;
            const data = streamBuffer;
            streamBuffer = '';

            // 数据下发到高亮渲染逻辑
            if (data.length <= 128) {
                term.write(highlightFilter(data));
            } else {
                writeQueue.push(data);
                if (!rafPending) {
                    rafPending = true;
                    requestAnimationFrame(flushQueue);
                }
            }
        };

        const onDataHandler = (data: string) => {
            // 如果收到换行、回车等基本控制符，立即冲刷之前积累的内容并同步输出
            if (data.includes('\n') || data.includes('\r')) {
                flushStream();
                term.write(highlightFilter(data));
                return;
            }

            // 收到含转义码的数据包（如光标移动），立即写，避免缓冲区乱序
            if (data.includes('\x1b')) {
                flushStream();
                term.write(highlightFilter(data));
                return;
            }

            streamBuffer += data;

            // 针对串口碎片化回显的聚合策略：
            // 如果遇到空格、命令行提示符结束符，稍微延迟 10ms 看看有没有后续（为了凑齐 ip route-static）
            // 如果是普通字符，延迟 30ms 聚合整个单词
            const lastChar = data[data.length - 1];
            const isCritical = ' >]#$'.includes(lastChar);

            if (streamBuffer.length > 512) {
                flushStream();
            } else {
                if (streamTimer) clearTimeout(streamTimer);
                streamTimer = setTimeout(flushStream, isCritical ? 10 : 30);
            }
        };

        const onSaveLogRequest = () => {
            if (!xtermRef.current) return;
            let content = '';
            const buffer = xtermRef.current.buffer.active;
            for (let i = 0; i < buffer.length; i++) {
                const line = buffer.getLine(i);
                if (line) content += line.translateToString(true) + '\n';
            }
            SaveTerminalLog(content).catch(() => { });
        };

        term.onSelectionChange(() => {
            const selection = term.getSelection();
            if (selection && selection.length > 0) {
                navigator.clipboard.writeText(selection).catch(() => { });
            }
        });

        const handlePaste = (e: ClipboardEvent) => {
            const text = e.clipboardData?.getData('text');
            if (text) {
                WriteTerminal(sessionId, text).catch(() => { });
            }
        };

        const handleContextMenu = (e: MouseEvent) => {
            e.preventDefault();
            const event = new CustomEvent('show-terminal-menu', {
                detail: {
                    x: e.clientX,
                    y: e.clientY,
                    sessionId: sessionId,
                    onClear: () => term.clear(),
                    onReconnect: () => {
                        EventsEmit('request-reconnect', sessionId);
                    },
                    onPaste: async () => {
                        try {
                            const text = await navigator.clipboard.readText();
                            if (text) {
                                WriteTerminal(sessionId, text).catch(() => { });
                            }
                        } catch (err) {
                            console.error('Failed to read clipboard:', err);
                        }
                    }
                }
            });
            window.dispatchEvent(event);
        };

        const terminalElement = terminalRef.current;
        terminalElement?.addEventListener('contextmenu', handleContextMenu);
        terminalElement?.addEventListener('paste', handlePaste as any);

        EventsOn(`terminal-output-${sessionId}`, onDataHandler);
        EventsOn(`request-save-log-${sessionId}`, onSaveLogRequest);

        return () => {
            console.log(`[UI] Disposing terminal session ${sessionId}`);
            if (resizeTimeout) clearTimeout(resizeTimeout);
            if (resizeRafId !== null) cancelAnimationFrame(resizeRafId);
            resizeObserver.disconnect();

            // Clear events FIRST to stop data flow
            EventsOff(`terminal-output-${sessionId}`);
            EventsOff(`request-save-log-${sessionId}`);

            try {
                if (xtermRef.current) {
                    xtermRef.current.dispose();
                    xtermRef.current = null;
                }
            } catch (e) {
                console.error("XTerm dispose error:", e);
            }

            terminalElement?.removeEventListener('contextmenu', handleContextMenu);
            terminalElement?.removeEventListener('paste', handlePaste as any);
        };
    }, [sessionId]);

    useEffect(() => {
        if (isActive && fitAddonRef.current) {
            setTimeout(() => {
                try { fitAddonRef.current?.fit(); } catch (e) { }
            }, 50);
        }
    }, [isActive]);

    return <div ref={terminalRef} id={`terminal-${sessionId}`} className="w-full h-full bg-[#0D1117] overflow-hidden" />;
});
