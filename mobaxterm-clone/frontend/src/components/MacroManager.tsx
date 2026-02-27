import { useState, useEffect } from 'react';
import { Play, Plus, Trash2, Edit3, Save, X, ChevronDown, ChevronUp, Clock } from 'lucide-react';
import { GetAllMacros, SaveMacro, DeleteMacro, ExecuteMacro } from '../../wailsjs/go/main/App';
import { db } from '../types';

interface MacroManagerProps {
    activeSessionId?: string | null;
}



export default function MacroManager({ activeSessionId }: MacroManagerProps) {
    const [macros, setMacros] = useState<db.Macro[]>([]);
    const [editingMacro, setEditingMacro] = useState<db.Macro | null>(null);
    const [isAdding, setIsAdding] = useState(false);

    useEffect(() => {
        loadMacros();
    }, []);

    const loadMacros = async () => {
        const data = await GetAllMacros();
        setMacros(data || []);
    };

    const handleSave = async () => {
        if (!editingMacro) return;
        await SaveMacro(editingMacro);
        setEditingMacro(null);
        setIsAdding(false);
        loadMacros();
    };

    const handleDelete = async (id: string) => {
        if (confirm('确定要删除这个宏吗？')) {
            await DeleteMacro(id);
            loadMacros();
        }
    };

    const handleExecute = async (macroId: string) => {
        if (!activeSessionId) {
            alert('请先连接到一个终端会话');
            return;
        }
        await ExecuteMacro(activeSessionId, macroId);
    };

    const addNewStep = () => {
        if (!editingMacro) return;
        const newSteps = [...editingMacro.steps, db.MacroStep.createFrom({ command: '', delayMs: 500, stepOrder: editingMacro.steps.length })];
        setEditingMacro(db.Macro.createFrom({ ...editingMacro, steps: newSteps }));
    };

    const removeStep = (index: number) => {
        if (!editingMacro) return;
        const newSteps = editingMacro.steps.filter((_, i) => i !== index).map((s, i) => db.MacroStep.createFrom({ ...s, stepOrder: i }));
        setEditingMacro(db.Macro.createFrom({ ...editingMacro, steps: newSteps }));
    };

    const updateStep = (index: number, field: keyof db.MacroStep, value: any) => {
        if (!editingMacro) return;
        const newSteps = [...editingMacro.steps];
        newSteps[index] = db.MacroStep.createFrom({ ...newSteps[index], [field]: value });
        setEditingMacro(db.Macro.createFrom({ ...editingMacro, steps: newSteps }));
    };

    return (
        <div className="flex flex-col h-full overflow-hidden">
            {!editingMacro && !isAdding ? (
                <div className="p-3 space-y-3 overflow-y-auto flex-1">
                    <div className="flex justify-between items-center mb-1">
                        <h3 className="text-[11px] font-semibold text-[#8B949E] uppercase tracking-wider">自动化宏</h3>
                        <button
                            onClick={() => {
                                setIsAdding(true);
                                setEditingMacro(db.Macro.createFrom({ id: `macro-${Date.now()}`, name: '', description: '', steps: [], createdAt: '' }));
                            }}
                            className="flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded transition-all duration-200 accent-gradient text-white hover:opacity-90"
                        >
                            <Plus size={12} />
                            新建宏
                        </button>
                    </div>

                    <div className="space-y-2">
                        {macros.length === 0 && (
                            <div className="text-center text-[11px] text-[#484F58] py-8 border border-dashed border-[#30363D] rounded-xl">
                                尚未创建宏指令
                            </div>
                        )}
                        {macros.map(macro => (
                            <div key={macro.id} className="p-3 rounded-xl bg-[#161B22] border border-[#30363D] group hover:border-[#388BFD]/50 transition-all">
                                <div className="flex justify-between items-start mb-1">
                                    <h4 className="text-[13px] font-bold text-[#C9D1D9]">{macro.name}</h4>
                                    <div className="flex items-center gap-1 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button
                                            onClick={() => handleExecute(macro.id)}
                                            className="p-1 rounded bg-[#238636]/10 text-[#238636] hover:bg-[#238636] hover:text-white transition-all"
                                            title="立即执行"
                                        >
                                            <Play size={12} fill="currentColor" />
                                        </button>
                                        <button
                                            onClick={() => setEditingMacro(macro)}
                                            className="p-1 rounded text-[#8B949E] hover:text-[#388BFD] hover:bg-[#388BFD]/10"
                                            title="编辑"
                                        >
                                            <Edit3 size={12} />
                                        </button>
                                        <button
                                            onClick={() => handleDelete(macro.id)}
                                            className="p-1 rounded text-[#8B949E] hover:text-[#F85149] hover:bg-[#F85149]/10"
                                            title="删除"
                                        >
                                            <Trash2 size={12} />
                                        </button>
                                    </div>
                                </div>
                                <p className="text-[11px] text-[#8B949E] mb-2 line-clamp-1">{macro.description || '无描述'}</p>
                                <div className="flex items-center gap-2 text-[10px] text-[#6E7681]">
                                    <span className="bg-[#0D1117] px-1.5 py-0.5 rounded border border-[#30363D]">{macro.steps?.length || 0} 步</span>
                                    <span>{macro.createdAt?.split('T')[0]}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            ) : (
                <div className="flex-1 flex flex-col overflow-hidden animate-fade-in p-3 pt-0">
                    <div className="sticky top-0 bg-[#0D1117] z-10 py-3 flex items-center justify-between border-b border-[#30363D] mb-4">
                        <div className="flex items-center gap-2">
                            <button onClick={() => { setEditingMacro(null); setIsAdding(false); }} className="p-1 text-[#8B949E] hover:text-[#C9D1D9]"><X size={16} /></button>
                            <h3 className="text-[13px] font-bold">{isAdding ? '新建宏' : '编辑宏'}</h3>
                        </div>
                        <button onClick={handleSave} className="px-3 py-1 rounded text-[11px] font-bold bg-[#388BFD] text-white hover:bg-[#1f6feb]">保存</button>
                    </div>

                    <div className="flex-1 overflow-y-auto space-y-4 px-1 pb-4">
                        <div className="space-y-1">
                            <label className="text-[11px] text-[#8B949E] font-medium ml-1">名称</label>
                            <input
                                value={editingMacro?.name || ''}
                                onChange={e => setEditingMacro(db.Macro.createFrom({ ...editingMacro!, name: e.target.value }))}
                                className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#388BFD] transition-all"
                                placeholder="宏名称 (例: 查看光衰)"
                            />
                        </div>

                        <div className="space-y-1">
                            <label className="text-[11px] text-[#8B949E] font-medium ml-1">描述 (可选)</label>
                            <input
                                value={editingMacro?.description || ''}
                                onChange={e => setEditingMacro(db.Macro.createFrom({ ...editingMacro!, description: e.target.value }))}
                                className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#388BFD] transition-all"
                                placeholder="输入宏的描述信息..."
                            />
                        </div>

                        <div className="space-y-3">
                            <div className="flex justify-between items-center ml-1">
                                <label className="text-[11px] text-[#8B949E] font-medium">指令步骤</label>
                                <button onClick={addNewStep} className="text-[11px] text-[#388BFD] hover:underline flex items-center gap-1 font-bold">
                                    <Plus size={10} strokeWidth={3} /> 添加步骤
                                </button>
                            </div>

                            <div className="space-y-2">
                                {editingMacro?.steps.map((step, index) => (
                                    <div key={index} className="p-3 bg-[#161B22] border border-[#30363D] rounded-xl space-y-3 relative group">
                                        <div className="flex justify-between items-center pr-1">
                                            <span className="text-[10px] font-bold text-[#484F58]">步骤 {index + 1}</span>
                                            <button onClick={() => removeStep(index)} className="text-[#F85149] p-1"><Trash2 size={12} /></button>
                                        </div>
                                        <div className="space-y-2">
                                            <input
                                                value={step.command}
                                                onChange={e => updateStep(index, 'command', e.target.value)}
                                                className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-[#388BFD]"
                                                placeholder="输入指令 (例: display this)"
                                            />
                                            <div className="flex items-center gap-2">
                                                <Clock size={12} className="text-[#6E7681]" />
                                                <span className="text-[10px] text-[#6E7681]">执行后等待</span>
                                                <input
                                                    type="number"
                                                    value={step.delayMs}
                                                    onChange={e => updateStep(index, 'delayMs', parseInt(e.target.value) || 0)}
                                                    className="w-16 bg-[#0D1117] border border-[#30363D] rounded px-2 py-0.5 text-[10px] text-center"
                                                />
                                                <span className="text-[10px] text-[#6E7681]">ms</span>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                                {editingMacro?.steps.length === 0 && (
                                    <div className="text-center py-4 text-[10px] text-[#484F58]">
                                        点击上方“添加步骤”开始编写宏
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
