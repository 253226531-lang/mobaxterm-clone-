import { useForm } from 'react-hook-form';
import { useState, useEffect } from 'react';
import { X, Wifi, Monitor, Cable, Loader2 } from 'lucide-react';
import { GetSerialPorts, GetAllSessionGroups, SelectPrivateKeyFile } from '../../wailsjs/go/main/App';

interface SessionModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (data: any) => void;
    initialData?: any;
}

const protocols = [
    { value: 'ssh', label: 'SSH', icon: Wifi, color: '#388BFD' },
    { value: 'telnet', label: 'Telnet', icon: Monitor, color: '#A371F7' },
    { value: 'serial', label: '串口', icon: Cable, color: '#D29922' },
];

export default function SessionModal({ isOpen, onClose, onSave, initialData }: SessionModalProps) {
    const { register, handleSubmit, watch, reset, setValue } = useForm({
        defaultValues: initialData || {
            name: '',
            protocol: 'ssh',
            host: '',
            port: 22,
            username: '',
            password: '',
            comPort: '',
            baudRate: 9600,
            dataBits: 8,
            stopBits: '1',
            parity: 'N',
            flowControl: 'None',
            description: '',
            encoding: 'UTF-8',
            groupId: '',
            privateKey: ''
        }
    });

    useEffect(() => {
        if (isOpen && initialData) {
            reset(initialData);
        } else if (isOpen && !initialData) {
            reset({
                name: '',
                protocol: 'ssh',
                host: '',
                port: 22,
                username: '',
                password: '',
                comPort: '',
                baudRate: 9600,
                dataBits: 8,
                stopBits: '1',
                parity: 'N',
                flowControl: 'None',
                description: '',
                encoding: 'UTF-8',
                groupId: '',
                privateKey: ''
            });
        }
    }, [isOpen, initialData, reset]);

    const [groups, setGroups] = useState<any[]>([]);

    useEffect(() => {
        if (isOpen) {
            GetAllSessionGroups().then((data: any) => setGroups(data || [])).catch(console.error);
        }
    }, [isOpen]);

    const handleSelectKey = async () => {
        try {
            const keyPath = await SelectPrivateKeyFile();
            if (keyPath) {
                setValue('privateKey', keyPath);
            }
        } catch (e) {
            console.error('选择私钥失败:', e);
        }
    };

    const selectedProtocol = watch('protocol');
    const [comPorts, setComPorts] = useState<string[]>([]);
    const [loadingPorts, setLoadingPorts] = useState(false);

    // 当选择串口协议时，自动获取系统COM口
    useEffect(() => {
        if (selectedProtocol === 'serial' && isOpen) {
            setLoadingPorts(true);
            GetSerialPorts()
                .then(ports => {
                    setComPorts(ports || []);
                    if (ports && ports.length > 0) {
                        setValue('comPort', ports[0]);
                    }
                })
                .catch(err => {
                    console.error('获取串口列表失败:', err);
                    setComPorts([]);
                })
                .finally(() => setLoadingPorts(false));
        }
    }, [selectedProtocol, isOpen, setValue]);

    if (!isOpen) return null;

    const onSubmit = (data: any) => {
        data.port = parseInt(data.port, 10) || 0;
        data.baudRate = parseInt(data.baudRate, 10) || 9600;
        data.dataBits = parseInt(data.dataBits, 10) || 8;
        onSave(data);
        reset();
        onClose();
    };

    const inputClass = "w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-[13px] text-[#C9D1D9] placeholder-[#484F58] focus:outline-none focus:border-[#388BFD] focus:ring-1 focus:ring-[#388BFD]/30 transition-all duration-200";
    const labelClass = "block text-[11px] font-medium text-[#8B949E] mb-1.5 uppercase tracking-wide";

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in">
            <div className="rounded-xl shadow-2xl w-[480px] flex flex-col overflow-hidden border border-[#30363D]" style={{ background: '#161B22' }}>
                {/* Header */}
                <div className="flex justify-between items-center px-5 py-4" style={{ borderBottom: '1px solid rgba(48,54,61,0.6)' }}>
                    <h2 className="text-[15px] font-semibold text-[#E6EDF3]">{initialData ? '编辑会话' : '新建会话'}</h2>
                    <button onClick={onClose} className="p-1 rounded-md text-[#6E7681] hover:text-[#C9D1D9] hover:bg-[#21262D] transition-all duration-200">
                        <X size={18} />
                    </button>
                </div>

                {/* Body */}
                <form id="session-form" onSubmit={handleSubmit(onSubmit)} className="px-5 py-4 flex-1 overflow-y-auto">
                    <div className="space-y-4">
                        {/* Protocol Selection */}
                        <div className="flex gap-2">
                            {protocols.map(({ value, label, icon: Icon, color }) => (
                                <label key={value} className="flex-1 cursor-pointer">
                                    <input type="radio" value={value} {...register('protocol')} className="sr-only peer" />
                                    <div className="flex items-center justify-center gap-2 py-2 rounded-lg border text-[12px] font-medium transition-all duration-200 border-[#30363D] text-[#6E7681] hover:border-[#484F58] hover:text-[#8B949E]"
                                        style={selectedProtocol === value ? { borderColor: color, background: `${color}15`, color } : {}}
                                    >
                                        <Icon size={14} />
                                        {label}
                                    </div>
                                </label>
                            ))}
                        </div>

                        {/* Name, Group & Encoding */}
                        <div className="flex gap-3">
                            <div className="flex-[2]">
                                <label className={labelClass}>会话名称</label>
                                <input {...register('name')} className={inputClass} placeholder="例如: 核心路由器" required />
                            </div>
                            <div className="flex-1">
                                <label className={labelClass}>所属分组</label>
                                <select {...register('groupId')} className={inputClass}>
                                    <option value="">[根目录]</option>
                                    {groups.map((g: any) => (
                                        <option key={g.id} value={g.id}>{g.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="flex-1">
                                <label className={labelClass}>终端编码</label>
                                <select {...register('encoding')} className={inputClass}>
                                    <option value="UTF-8">UTF-8</option>
                                    <option value="GBK">GBK (中文)</option>
                                </select>
                            </div>
                        </div>

                        {selectedProtocol === 'serial' ? (
                            <>
                                <div className="flex gap-3">
                                    <div className="flex-1">
                                        <label className={labelClass}>
                                            串口
                                            {loadingPorts && <Loader2 size={10} className="inline-block ml-1 animate-spin text-[#388BFD]" />}
                                        </label>
                                        {comPorts.length > 0 ? (
                                            <select {...register('comPort')} className={inputClass}>
                                                {comPorts.map(port => (
                                                    <option key={port} value={port}>{port}</option>
                                                ))}
                                            </select>
                                        ) : (
                                            <div>
                                                <input {...register('comPort')} className={inputClass} placeholder="COM1" />
                                                {!loadingPorts && (
                                                    <p className="text-[10px] text-[#D29922] mt-1">未检测到串口设备，请手动输入</p>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex-1">
                                        <label className={labelClass}>波特率</label>
                                        <select {...register('baudRate')} className={inputClass}>
                                            <option value={9600}>9600</option>
                                            <option value={14400}>14400</option>
                                            <option value={19200}>19200</option>
                                            <option value={38400}>38400</option>
                                            <option value={57600}>57600</option>
                                            <option value={115200}>115200</option>
                                        </select>
                                    </div>
                                </div>
                                <div className="flex gap-3 mt-3">
                                    <div className="flex-1">
                                        <label className={labelClass}>数据位</label>
                                        <select {...register('dataBits')} className={inputClass}>
                                            <option value={8}>8</option>
                                            <option value={7}>7</option>
                                            <option value={6}>6</option>
                                            <option value={5}>5</option>
                                        </select>
                                    </div>
                                    <div className="flex-1">
                                        <label className={labelClass}>校验位</label>
                                        <select {...register('parity')} className={inputClass}>
                                            <option value="N">None</option>
                                            <option value="E">Even</option>
                                            <option value="O">Odd</option>
                                            <option value="M">Mark</option>
                                            <option value="S">Space</option>
                                        </select>
                                    </div>
                                </div>
                                <div className="flex gap-3 mt-3">
                                    <div className="flex-1">
                                        <label className={labelClass}>停止位</label>
                                        <select {...register('stopBits')} className={inputClass}>
                                            <option value="1">1</option>
                                            <option value="1.5">1.5</option>
                                            <option value="2">2</option>
                                        </select>
                                    </div>
                                    <div className="flex-1">
                                        <label className={labelClass}>流控</label>
                                        <select {...register('flowControl')} className={inputClass}>
                                            <option value="None">None</option>
                                            <option value="Hardware">Hardware (RTS/CTS)</option>
                                            <option value="Software">Software (XON/XOFF)</option>
                                        </select>
                                    </div>
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="flex gap-3">
                                    <div className="flex-[3]">
                                        <label className={labelClass}>远程主机 *</label>
                                        <input {...register('host')} className={inputClass} placeholder="192.168.1.1" required />
                                    </div>
                                    <div className="flex-1">
                                        <label className={labelClass}>端口</label>
                                        <input type="number" {...register('port')} className={inputClass} />
                                    </div>
                                </div>
                                <div>
                                    <label className={labelClass}>用户名</label>
                                    <input {...register('username')} className={inputClass} placeholder="root" />
                                </div>
                                <div>
                                    <label className={labelClass}>密码</label>
                                    <input type="password" {...register('password')} className={inputClass} placeholder="留空则提示输入" />
                                </div>
                                <div>
                                    <label className={labelClass}>非对称凭证 (私钥认证)</label>
                                    <div className="flex gap-2">
                                        <input type="text" {...register('privateKey')} className={inputClass} placeholder="可选：绑定证书如 .pem / id_rsa" readOnly />
                                        <button type="button" onClick={handleSelectKey} className="px-3 shrink-0 rounded-lg text-[12px] font-medium text-[#8B949E] border border-[#30363D] hover:border-[#6E7681] hover:text-[#C9D1D9] transition-all duration-200">
                                            选择私钥
                                        </button>
                                    </div>
                                    <p className="text-[10px] text-[#6E7681] mt-1.5">* 如果证书受密码保护，请在上方【密码】栏填入该锁匙密码。</p>
                                </div>
                            </>
                        )}

                        <div>
                            <label className={labelClass}>备注</label>
                            <textarea {...register('description')} className={`${inputClass} resize-none h-16`} placeholder="可选描述..."></textarea>
                        </div>
                    </div>
                </form>

                {/* Footer */}
                <div className="flex justify-end px-5 py-3 gap-2" style={{ borderTop: '1px solid rgba(48,54,61,0.6)', background: '#0D1117' }}>
                    <button onClick={onClose} className="px-4 py-1.5 rounded-lg text-[12px] font-medium text-[#8B949E] border border-[#30363D] hover:border-[#6E7681] hover:text-[#C9D1D9] transition-all duration-200">
                        取消
                    </button>
                    <button type="submit" form="session-form" className="px-5 py-1.5 rounded-lg text-[12px] font-medium text-white accent-gradient hover:opacity-90 transition-all duration-200 shadow-sm">
                        {initialData ? '保存修改' : '立即连接'}
                    </button>
                </div>
            </div>
        </div>
    );
}
