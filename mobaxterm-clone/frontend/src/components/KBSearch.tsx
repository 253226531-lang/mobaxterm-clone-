import { useState, useMemo } from 'react';
import { SearchKnowledgeBase, WriteTerminalSequence } from '../../wailsjs/go/main/App';
import { Search, Copy, Check, ChevronDown, ChevronRight, Sparkles, Send, Play, Clock } from 'lucide-react';

interface KBEntry {
    id: number;
    title: string;
    deviceType: string;
    commands: string;
    description: string;
}

interface KBSearchProps {
    activeSessionId?: string | null;
}

export default function KBSearch({ activeSessionId }: KBSearchProps) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<KBEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [expandedId, setExpandedId] = useState<number | null>(null);
    const [copied, setCopied] = useState<number | null>(null);
    const [sent, setSent] = useState<number | null>(null);
    const [searched, setSearched] = useState(false);
    const [lineDelay, setLineDelay] = useState(100); // 默认 100ms 延时

    // 变量检测逻辑
    const [varInputs, setVarInputs] = useState<Record<string, string>>({});

    const handleSearch = async () => {
        if (!query.trim()) return;
        setLoading(true);
        setSearched(true);
        try {
            const data = await SearchKnowledgeBase(query);
            setResults(data || []);
        } catch (e) {
            console.error('搜索失败:', e);
        } finally {
            setLoading(false);
        }
    };

    const detectVariables = (text: string) => {
        const regex = /\{\{(.+?)\}\}/g;
        const vars = new Set<string>();
        let match;
        while ((match = regex.exec(text)) !== null) {
            vars.add(match[1]);
        }
        return Array.from(vars);
    };

    const getProcessedCommands = (commands: string) => {
        let processed = commands;
        Object.entries(varInputs).forEach(([key, val]) => {
            const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
            processed = processed.replace(regex, val || `{{${key}}}`);
        });
        return processed;
    };

    const handleCopy = (text: string, id: number) => {
        const processed = getProcessedCommands(text);
        navigator.clipboard.writeText(processed);
        setCopied(id);
        setTimeout(() => setCopied(null), 2000);
    };

    const handleSend = async (text: string, id: number) => {
        if (!activeSessionId) {
            alert("请先选择一个活动终端会话");
            return;
        }
        const processed = getProcessedCommands(text);
        try {
            // 使用新增加的 Sequence 方法，按照行发送并支持延时
            await WriteTerminalSequence(activeSessionId, processed, lineDelay);
            setSent(id);
            setTimeout(() => setSent(null), 2000);
        } catch (e) {
            console.error('发送失败:', e);
            alert("发送失败: " + e);
        }
    };

    const toggleExpand = (id: number) => {
        setExpandedId(expandedId === id ? null : id);
        if (expandedId !== id) {
            setVarInputs({});
        }
    };

    return (
        <div className="flex flex-col h-full gap-3">
            {/* 顶栏设置 */}
            <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-1.5 text-[11px] text-[#8B949E]">
                    <Clock size={12} />
                    <span>行延时:</span>
                    <select
                        value={lineDelay}
                        onChange={(e) => setLineDelay(Number(e.target.value))}
                        className="bg-[#161B22] border border-[#30363D] rounded px-1 py-0.5 text-[#C9D1D9] focus:outline-none focus:border-[#388BFD]"
                    >
                        <option value={0}>无</option>
                        <option value={50}>50ms</option>
                        <option value={100}>100ms</option>
                        <option value={200}>200ms</option>
                        <option value={500}>500ms</option>
                    </select>
                </div>
            </div>

            {/* 搜索框 */}
            <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#6E7681]" />
                <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                    placeholder="搜索命令或配置..."
                    className="w-full pl-8 pr-3 py-2 text-[12px] rounded-lg border border-[#30363D] bg-[#0D1117] text-[#C9D1D9] placeholder-[#484F58] focus:outline-none focus:border-[#388BFD] focus:ring-1 focus:ring-[#388BFD]/30 transition-all duration-200"
                />
            </div>

            {loading && (
                <div className="flex items-center gap-2 text-[11px] text-[#388BFD] px-1">
                    <div className="w-3 h-3 border-2 border-[#388BFD] border-t-transparent rounded-full animate-spin" />
                    搜索中...
                </div>
            )}

            {/* 空状态 */}
            {!searched && results.length === 0 && !loading && (
                <div className="flex flex-col items-center justify-center flex-1 text-center px-4 gap-3 opacity-60">
                    <Sparkles size={28} className="text-[#388BFD] animate-float" />
                    <div>
                        <p className="text-[12px] text-[#8B949E]">输入关键字搜索</p>
                        <p className="text-[10px] text-[#484F58] mt-0.5">支持设备类型、命令、标题等</p>
                    </div>
                </div>
            )}

            {/* 无结果 */}
            {searched && results.length === 0 && !loading && (
                <div className="text-center text-[11px] text-[#484F58] mt-6">
                    未找到 "<span className="text-[#8B949E]">{query}</span>" 相关结果
                </div>
            )}

            {/* 搜索结果 */}
            <div className="flex-1 overflow-y-auto space-y-2">
                {results.map((entry, idx) => {
                    const variables = detectVariables(entry.commands);
                    const isExpanded = expandedId === entry.id;

                    return (
                        <div
                            key={entry.id}
                            className="rounded-lg border border-[#21262D] bg-[#161B22] overflow-hidden transition-all duration-200 hover:border-[#30363D] animate-fade-in"
                            style={{ animationDelay: `${idx * 50}ms` }}
                        >
                            {/* 标题行 */}
                            <div
                                className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-[#1C2128] transition-colors"
                                onClick={() => toggleExpand(entry.id)}
                            >
                                {isExpanded ? (
                                    <ChevronDown size={12} className="text-[#388BFD] shrink-0" />
                                ) : (
                                    <ChevronRight size={12} className="text-[#6E7681] shrink-0" />
                                )}
                                <span className="text-[12px] font-medium text-[#C9D1D9] truncate flex-1">
                                    {entry.title}
                                </span>
                                <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium shrink-0"
                                    style={{ background: 'rgba(56,139,253,0.1)', color: '#388BFD' }}>
                                    {entry.deviceType}
                                </span>
                            </div>

                            {/* 展开详情 */}
                            {isExpanded && (
                                <div className="px-3 pb-3 animate-slide-down" style={{ borderTop: '1px solid #21262D' }}>
                                    {entry.description && (
                                        <p className="text-[11px] text-[#8B949E] mt-2 mb-2 leading-relaxed">
                                            {entry.description}
                                        </p>
                                    )}

                                    {/* 变量输入区域 */}
                                    {variables.length > 0 && (
                                        <div className="mt-2 mb-3 p-2 rounded bg-[#0D1117]/50 border border-[#30363D]">
                                            <p className="text-[10px] text-[#8B949E] mb-2 font-medium">参数输入:</p>
                                            <div className="space-y-2">
                                                {variables.map(v => (
                                                    <div key={v} className="flex items-center gap-2">
                                                        <span className="text-[10px] font-mono text-[#484F58] w-16 truncate" title={v}>{v}:</span>
                                                        <input
                                                            type="text"
                                                            value={varInputs[v] || ''}
                                                            onChange={(e) => setVarInputs(prev => ({ ...prev, [v]: e.target.value }))}
                                                            placeholder={`请输入 ${v}`}
                                                            className="flex-1 bg-[#0D1117] border border-[#21262D] rounded px-1.5 py-0.5 text-[11px] focus:outline-none focus:border-[#388BFD]"
                                                        />
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    <div className="relative group mt-1">
                                        <pre className="bg-[#0D1117] rounded-md p-2.5 text-[11px] text-[#7EE787] font-mono whitespace-pre-wrap break-words max-h-44 overflow-y-auto border border-[#21262D] leading-relaxed">
                                            {getProcessedCommands(entry.commands)}
                                        </pre>
                                        <div className="absolute top-2 right-2 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-all duration-200">
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleSend(entry.commands, entry.id);
                                                }}
                                                className={`p-1.5 rounded-md transition-all duration-200 ${sent === entry.id
                                                        ? 'bg-[#388BFD]/20 text-[#388BFD]'
                                                        : 'bg-[#21262D] text-[#6E7681] hover:text-[#C9D1D9]'
                                                    }`}
                                                title="发送到终端"
                                            >
                                                {sent === entry.id ? <Check size={12} /> : <Play size={12} />}
                                            </button>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleCopy(entry.commands, entry.id);
                                                }}
                                                className={`p-1.5 rounded-md transition-all duration-200 ${copied === entry.id
                                                        ? 'bg-emerald-500/20 text-emerald-400'
                                                        : 'bg-[#21262D] text-[#6E7681] hover:text-[#C9D1D9]'
                                                    }`}
                                                title="复制命令"
                                            >
                                                {copied === entry.id ? <Check size={12} /> : <Copy size={12} />}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
