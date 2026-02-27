import { useState, useEffect } from 'react';
import {
    GetAllKnowledgeEntries,
    AddKnowledgeEntry,
    UpdateKnowledgeEntry,
    DeleteKnowledgeEntry,
    ExportKnowledgeBase,
    ImportKnowledgeBase
} from '../../wailsjs/go/main/App';
import { X, Plus, Edit, Trash2, Save, Download, Upload, Info, Sparkles } from 'lucide-react';

interface Entry {
    id: number;
    title: string;
    deviceType: string;
    commands: string;
    description: string;
}

export default function KnowledgeAdmin({ onClose }: { onClose: () => void }) {
    const [entries, setEntries] = useState<Entry[]>([]);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [formData, setFormData] = useState({ title: '', deviceType: '', commands: '', description: '' });
    const [isProcessing, setIsProcessing] = useState(false);

    const loadEntries = async () => {
        try {
            const data = await GetAllKnowledgeEntries();
            setEntries(data || []);
        } catch (e) {
            console.error(e);
        }
    };

    useEffect(() => {
        loadEntries();
    }, []);

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            if (editingId) {
                await UpdateKnowledgeEntry(editingId, formData.title, formData.deviceType, formData.commands, formData.description);
            } else {
                await AddKnowledgeEntry(formData.title, formData.deviceType, formData.commands, formData.description);
            }
            setEditingId(null);
            setFormData({ title: '', deviceType: '', commands: '', description: '' });
            loadEntries();
        } catch (e) {
            alert("保存失败: " + e);
        }
    };

    const handleEdit = (entry: Entry) => {
        setEditingId(entry.id);
        setFormData({ title: entry.title, deviceType: entry.deviceType, commands: entry.commands, description: entry.description });
    };

    const handleDelete = async (id: number) => {
        if (confirm("确定要删除此条目吗？")) {
            try {
                await DeleteKnowledgeEntry(id);
                loadEntries();
            } catch (e) {
                alert("删除失败: " + e);
            }
        }
    };

    const handleExport = async () => {
        try {
            await ExportKnowledgeBase();
            alert("导出成功！");
        } catch (e) {
            if (e) alert("导出失败: " + e);
        }
    };

    const handleImport = async () => {
        try {
            setIsProcessing(true);
            await ImportKnowledgeBase();
            await loadEntries();
            alert("导入成功！");
        } catch (e) {
            if (e) alert("导入失败: " + e);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleCancel = () => {
        setEditingId(null);
        setFormData({ title: '', deviceType: '', commands: '', description: '' });
    };

    const inputClass = "w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-[13px] text-[#C9D1D9] placeholder-[#484F58] focus:outline-none focus:border-[#388BFD] focus:ring-1 focus:ring-[#388BFD]/30 transition-all duration-200";
    const labelClass = "block text-[11px] font-medium text-[#8B949E] mb-1.5 uppercase tracking-wide";

    return (
        <div className="flex flex-col h-full animate-fade-in" style={{ background: '#0D1117' }}>
            {/* Header */}
            <div className="flex justify-between items-center px-6 py-4 shrink-0" style={{ borderBottom: '1px solid rgba(48,54,61,0.6)', background: '#161B22' }}>
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg accent-gradient flex items-center justify-center">
                        <Save size={18} className="text-white" />
                    </div>
                    <div>
                        <h2 className="text-[16px] font-semibold text-[#E6EDF3]">知识库中心</h2>
                        <p className="text-[11px] text-[#8B949E]">管理您的设备配置、常用命令和技术文档</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={handleImport}
                        disabled={isProcessing}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12px] font-medium text-[#8B949E] border border-[#30363D] hover:border-[#6E7681] hover:text-[#C9D1D9] transition-all duration-200"
                    >
                        <Upload size={14} />
                        导入 JSON
                    </button>
                    <button
                        onClick={handleExport}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12px] font-medium text-[#8B949E] border border-[#30363D] hover:border-[#6E7681] hover:text-[#C9D1D9] transition-all duration-200"
                    >
                        <Download size={14} />
                        备份导出
                    </button>
                    <div className="w-[1px] h-6 bg-[#30363D] mx-2" />
                    <button onClick={onClose} className="p-1.5 rounded-md text-[#6E7681] hover:text-[#C9D1D9] hover:bg-[#21262D] transition-all duration-200">
                        <X size={20} />
                    </button>
                </div>
            </div>

            <div className="flex-1 flex overflow-hidden">
                {/* Editor Panel */}
                <div className="w-96 p-6 overflow-y-auto shrink-0" style={{ borderRight: '1px solid rgba(48,54,61,0.6)', background: '#161B22' }}>
                    <div className="flex items-center gap-2 mb-6 text-[#388BFD]">
                        {editingId ? <Edit size={16} /> : <Plus size={16} />}
                        <h3 className="text-[14px] font-semibold">{editingId ? "修改现有条目" : "创建新知识条目"}</h3>
                    </div>

                    <form onSubmit={handleSave} className="space-y-5">
                        <div>
                            <label className={labelClass}>标题</label>
                            <input
                                value={formData.title}
                                onChange={e => setFormData({ ...formData, title: e.target.value })}
                                className={inputClass}
                                placeholder="例如: H3C 交换机清空配置"
                                required
                            />
                        </div>
                        <div>
                            <label className={labelClass}>设备/分类 (支持层级 如 H3C/Switch)</label>
                            <input
                                value={formData.deviceType}
                                onChange={e => setFormData({ ...formData, deviceType: e.target.value })}
                                className={inputClass}
                                placeholder="华为, 思科, 或专用路径"
                                required
                            />
                        </div>
                        <div>
                            <label className={labelClass}>
                                命令序列
                                <span className="ml-2 lowercase font-normal opacity-60">(支持 {"{{变量}}"})</span>
                            </label>
                            <textarea
                                value={formData.commands}
                                onChange={e => setFormData({ ...formData, commands: e.target.value })}
                                className={`${inputClass} h-40 font-mono text-[12px] resize-none leading-relaxed`}
                                placeholder="system-view&#10;interface {{port}}&#10;shutdown"
                                required
                            />
                        </div>
                        <div>
                            <label className={labelClass}>详细描述</label>
                            <textarea
                                value={formData.description}
                                onChange={e => setFormData({ ...formData, description: e.target.value })}
                                className={`${inputClass} h-24 resize-none`}
                                placeholder="该命令组的作用和注意事项..."
                            />
                        </div>
                        <div className="flex gap-2 pt-2">
                            <button type="submit" className="flex-1 accent-gradient text-white rounded-lg py-2 text-[13px] font-medium flex items-center justify-center gap-2 shadow-lg shadow-blue-500/10 hover:opacity-90 transition-all duration-200">
                                <Save size={16} /> {editingId ? "更新此条目" : "保存到库"}
                            </button>
                            {editingId && (
                                <button type="button" onClick={handleCancel} className="bg-[#21262D] hover:bg-[#30363D] text-[#C9D1D9] rounded-lg px-4 py-2 text-[13px] border border-[#30363D] transition-all duration-200">
                                    取消
                                </button>
                            )}
                        </div>
                    </form>
                </div>

                {/* List Panel */}
                <div className="flex-1 p-6 overflow-y-auto">
                    <div className="flex items-center gap-2 mb-4 text-[#8B949E]">
                        <Info size={14} />
                        <span className="text-[12px]">共收录 {entries.length} 条技术方案</span>
                    </div>

                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                        {entries.length === 0 ? (
                            <div className="col-span-full py-20 text-center">
                                <Sparkles size={40} className="mx-auto text-[#30363D] mb-4" />
                                <p className="text-[#6E7681] text-[13px]">暂无知识库条目，开始创建吧！</p>
                            </div>
                        ) : entries.map(entry => (
                            <div key={entry.id} className="group p-4 rounded-xl border border-[#30363D] bg-[#161B22] hover:border-[#388BFD]/40 transition-all duration-300 relative">
                                <div className="flex justify-between items-start mb-2">
                                    <span className="text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-tighter" style={{ background: 'rgba(56,139,253,0.1)', color: '#388BFD' }}>
                                        {entry.deviceType}
                                    </span>
                                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button onClick={() => handleEdit(entry)} className="p-1.5 text-[#6E7681] hover:text-[#388BFD] hover:bg-[#388BFD]/10 rounded-md transition-all">
                                            <Edit size={14} />
                                        </button>
                                        <button onClick={() => handleDelete(entry.id)} className="p-1.5 text-[#6E7681] hover:text-[#F85149] hover:bg-[#F85149]/10 rounded-md transition-all">
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                </div>
                                <h4 className="text-[14px] font-semibold text-[#E6EDF3] mb-1 group-hover:text-[#388BFD] transition-colors">{entry.title}</h4>
                                <p className="text-[12px] text-[#8B949E] line-clamp-2 mb-3 h-9 leading-relaxed">{entry.description || "暂无描述"}</p>
                                <div className="bg-[#0D1117] rounded-lg p-2 max-h-24 overflow-hidden relative">
                                    <pre className="text-[10px] font-mono text-[#7EE787] leading-tight">{entry.commands}</pre>
                                    <div className="absolute inset-0 bg-gradient-to-t from-[#0D1117] to-transparent opacity-40"></div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
