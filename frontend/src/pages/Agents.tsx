import { useState, useEffect } from 'react'
import { Play, Power, Clock, Cpu, Bot, Bell, Settings2 } from 'lucide-react'
import { fetchAPI, type AIService, type NotifyChannel } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectLabel, SelectItem } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'

interface AgentConfig {
  id: number
  name: string
  display_name: string
  description: string
  enabled: boolean
  schedule: string
  execution_mode: string
  ai_model_id: number | null
  notify_channel_ids: number[]
  config: Record<string, unknown>
}

interface SchedulePreview {
  schedule: string
  timezone: string
  next_runs: string[]
}

// 调度类型
type ScheduleType = 'daily' | 'weekdays' | 'interval' | 'cron'

interface ScheduleConfig {
  type: ScheduleType
  time?: string      // HH:MM 格式
  interval?: number  // 分钟数
  cron?: string      // 自定义 cron
}

// cron 转友好配置
function parseCronToConfig(cron: string): ScheduleConfig {
  if (!cron) return { type: 'daily', time: '15:30' }

  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return { type: 'cron', cron }

  const [minute, hour, , , dayOfWeek] = parts

  // 检测间隔模式 */N
  if (minute.startsWith('*/')) {
    const interval = parseInt(minute.slice(2))
    if (!isNaN(interval)) return { type: 'interval', interval }
  }

  // 检测每天或工作日
  const m = parseInt(minute)
  const h = parseInt(hour)
  if (!isNaN(m) && !isNaN(h)) {
    const time = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`
    if (dayOfWeek === '1-5') return { type: 'weekdays', time }
    if (dayOfWeek === '*') return { type: 'daily', time }
  }

  return { type: 'cron', cron }
}

// 友好配置转 cron
function configToCron(config: ScheduleConfig): string {
  switch (config.type) {
    case 'daily': {
      const [h, m] = (config.time || '15:30').split(':')
      return `${parseInt(m)} ${parseInt(h)} * * *`
    }
    case 'weekdays': {
      const [h, m] = (config.time || '15:30').split(':')
      return `${parseInt(m)} ${parseInt(h)} * * 1-5`
    }
    case 'interval':
      return `*/${config.interval || 30} * * * *`
    case 'cron':
      return config.cron || '0 15 * * *'
    default:
      return '0 15 * * *'
  }
}

// 友好显示调度
function formatSchedule(cron: string): string {
  const config = parseCronToConfig(cron)
  switch (config.type) {
    case 'daily':
      return `每天 ${config.time}`
    case 'weekdays':
      return `工作日 ${config.time}`
    case 'interval':
      return `每 ${config.interval} 分钟`
    case 'cron':
      return cron
    default:
      return cron
  }
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentConfig[]>([])
  const [services, setServices] = useState<AIService[]>([])
  const [channels, setChannels] = useState<NotifyChannel[]>([])
  const [loading, setLoading] = useState(true)
  const [triggering, setTriggering] = useState<string | null>(null)

  const [previews, setPreviews] = useState<Record<string, SchedulePreview | { error: string }>>({})

  // 调度编辑弹窗
  const [scheduleDialogAgent, setScheduleDialogAgent] = useState<AgentConfig | null>(null)
  const [scheduleConfig, setScheduleConfig] = useState<ScheduleConfig>({ type: 'daily', time: '15:30' })

  const { toast } = useToast()

  const formatPreviewTime = (iso: string, tz?: string): string => {
    try {
      const d = new Date(iso)
      if (isNaN(d.getTime())) return iso
      return d.toLocaleString('zh-CN', {
        timeZone: tz || undefined,
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    } catch {
      return iso
    }
  }

  const load = async () => {
    try {
      const [agentData, servicesData, channelData] = await Promise.all([
        fetchAPI<AgentConfig[]>('/agents'),
        fetchAPI<AIService[]>('/providers/services'),
        fetchAPI<NotifyChannel[]>('/channels'),
      ])
      setAgents(agentData)
      setServices(servicesData)
      setChannels(channelData)

      // 预加载未来触发时间（避免“工作日/周末”语义误解）
      const previewPairs = await Promise.all(agentData.map(async a => {
        if (!a.schedule) return [a.name, { schedule: '', timezone: '', next_runs: [] }] as const
        try {
          const p = await fetchAPI<SchedulePreview>(`/agents/${a.name}/schedule/preview?count=3`)
          return [a.name, p] as const
        } catch (e) {
          const msg = e instanceof Error ? e.message : '预览失败'
          return [a.name, { error: msg }] as const
        }
      }))
      setPreviews(Object.fromEntries(previewPairs))
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const toggleAgent = async (agent: AgentConfig) => {
    await fetchAPI(`/agents/${agent.name}`, {
      method: 'PUT',
      body: JSON.stringify({ enabled: !agent.enabled }),
    })
    load()
  }

  const triggerAgent = async (name: string) => {
    setTriggering(name)
    try {
      await fetchAPI(`/agents/${name}/trigger`, { method: 'POST' })
      toast('Agent 已触发', 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : '触发失败', 'error')
    } finally {
      setTriggering(null)
    }
  }

  const updateAgentModel = async (agent: AgentConfig, modelId: number | null) => {
    await fetchAPI(`/agents/${agent.name}`, {
      method: 'PUT',
      body: JSON.stringify({ ai_model_id: modelId }),
    })
    load()
  }

  const toggleAgentChannel = async (agent: AgentConfig, channelId: number) => {
    const current = agent.notify_channel_ids || []
    const newIds = current.includes(channelId)
      ? current.filter(id => id !== channelId)
      : [...current, channelId]
    await fetchAPI(`/agents/${agent.name}`, {
      method: 'PUT',
      body: JSON.stringify({ notify_channel_ids: newIds }),
    })
    load()
  }

  const openScheduleDialog = (agent: AgentConfig) => {
    setScheduleDialogAgent(agent)
    setScheduleConfig(parseCronToConfig(agent.schedule))
  }

  const saveSchedule = async () => {
    if (!scheduleDialogAgent) return
    const cron = configToCron(scheduleConfig)
    await fetchAPI(`/agents/${scheduleDialogAgent.name}`, {
      method: 'PUT',
      body: JSON.stringify({ schedule: cron }),
    })
    setScheduleDialogAgent(null)
    load()
    toast('调度已更新', 'success')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div>
      <div className="mb-4 md:mb-8">
        <h1 className="text-[20px] md:text-[22px] font-bold text-foreground tracking-tight">Agent</h1>
        <p className="text-[12px] md:text-[13px] text-muted-foreground mt-0.5 md:mt-1">自动化任务管理与调度</p>
      </div>

      {agents.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-20">
          <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
            <Bot className="w-6 h-6 text-primary" />
          </div>
          <p className="text-[15px] font-semibold text-foreground">暂无 Agent</p>
          <p className="text-[13px] text-muted-foreground mt-1.5">启动后台服务后 Agent 会自动注册</p>
        </div>
      ) : (
        <div className="space-y-4">
          {agents.map(agent => {
            const modeLabel = agent.execution_mode === 'single' ? '逐只分析' : '批量分析'
            const preview = previews[agent.name]
            return (
              <div key={agent.name} className="card-hover p-4 md:p-6">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 sm:gap-6">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3">
                      <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${agent.enabled ? 'bg-emerald-500' : 'bg-border'}`} />
                      <h3 className="text-[15px] font-semibold text-foreground">{agent.display_name}</h3>
                      <Badge variant="secondary" className="text-[10px]">{modeLabel}</Badge>
                    </div>
                    <p className="text-[13px] text-muted-foreground mt-2.5 ml-[22px] leading-relaxed">{agent.description}</p>

                    {/* 执行周期 - 可点击编辑 */}
                    <div className="flex items-center gap-2.5 mt-3.5 ml-[22px] flex-wrap">
                      <button
                        onClick={() => openScheduleDialog(agent)}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-accent/50 hover:bg-accent transition-colors"
                      >
                        <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="text-[12px] text-foreground">{formatSchedule(agent.schedule)}</span>
                        <Settings2 className="w-3 h-3 text-muted-foreground/50" />
                      </button>
                    </div>

                    {/* 未来触发时间（按调度时区） */}
                    {'error' in (preview || {}) ? (
                      <div className="mt-2 ml-[22px] text-[11px] text-muted-foreground">
                        未来触发时间：{(preview as { error: string }).error}
                      </div>
                    ) : (preview as SchedulePreview | undefined)?.next_runs?.length ? (
                      <div className="mt-2 ml-[22px] flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                        <span className="opacity-80">未来 3 次：</span>
                        {(preview as SchedulePreview).next_runs.map((t, i) => (
                          <span
                            key={i}
                            className="px-1.5 py-0.5 rounded border border-border/60 bg-accent/30 font-mono"
                            title={t}
                          >
                            {formatPreviewTime(t, (preview as SchedulePreview).timezone)}
                          </span>
                        ))}
                        {(preview as SchedulePreview).timezone ? (
                          <span className="opacity-60">({(preview as SchedulePreview).timezone})</span>
                        ) : null}
                      </div>
                    ) : null}

                    <div className="mt-4 ml-[22px] space-y-3">
                      {/* AI Model select */}
                      <div className="flex items-center gap-2">
                        <Cpu className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                        <Select
                          value={agent.ai_model_id?.toString() ?? '__default__'}
                          onValueChange={val => updateAgentModel(agent, val === '__default__' ? null : parseInt(val))}
                        >
                          <SelectTrigger className="h-7 text-[12px] w-auto min-w-[140px] px-2.5 bg-accent/50 border-border/50">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__default__">系统默认</SelectItem>
                            {services.map(svc => (
                              <SelectGroup key={svc.id}>
                                <SelectLabel>{svc.name}</SelectLabel>
                                {svc.models.map(m => (
                                  <SelectItem key={m.id} value={m.id.toString()}>
                                    {m.name}{m.name !== m.model ? ` (${m.model})` : ''}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Notify Channel multi-select */}
                      {channels.length > 0 && (
                        <div className="flex items-center gap-2 flex-wrap">
                          <Bell className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                          {channels.map(ch => {
                            const isSelected = (agent.notify_channel_ids || []).includes(ch.id)
                            return (
                              <button
                                key={ch.id}
                                onClick={() => toggleAgentChannel(agent, ch.id)}
                                className={`text-[11px] px-2 py-0.5 rounded-md border transition-colors ${
                                  isSelected
                                    ? 'bg-primary/10 border-primary/30 text-primary font-medium'
                                    : 'bg-accent/30 border-border/50 text-muted-foreground hover:border-primary/30'
                                }`}
                              >
                                {ch.name}
                              </button>
                            )
                          })}
                          {(agent.notify_channel_ids || []).length === 0 && (
                            <span className="text-[11px] text-muted-foreground">系统默认</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 ml-[22px] sm:ml-0">
                    <Button
                      variant="secondary"
                      size="sm"
                      className="h-8"
                      onClick={() => triggerAgent(agent.name)}
                      disabled={!agent.enabled || triggering === agent.name}
                    >
                      {triggering === agent.name ? (
                        <span className="w-3.5 h-3.5 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                      ) : (
                        <Play className="w-3.5 h-3.5" />
                      )}
                      <span className="hidden sm:inline">{triggering === agent.name ? '运行中' : '触发'}</span>
                    </Button>
                    <Button
                      variant={agent.enabled ? 'destructive' : 'default'}
                      size="sm"
                      className="h-8"
                      onClick={() => toggleAgent(agent)}
                    >
                      <Power className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">{agent.enabled ? '停用' : '启用'}</span>
                    </Button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* 调度设置弹窗 */}
      <Dialog open={!!scheduleDialogAgent} onOpenChange={open => !open && setScheduleDialogAgent(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>设置执行周期</DialogTitle>
            <DialogDescription>{scheduleDialogAgent?.display_name}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div>
              <Label>调度类型</Label>
              <Select
                value={scheduleConfig.type}
                onValueChange={val => setScheduleConfig({ ...scheduleConfig, type: val as ScheduleType })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">每天定时</SelectItem>
                  <SelectItem value="weekdays">工作日定时</SelectItem>
                  <SelectItem value="interval">固定间隔</SelectItem>
                  <SelectItem value="cron">自定义 Cron</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {(scheduleConfig.type === 'daily' || scheduleConfig.type === 'weekdays') && (
              <div>
                <Label>执行时间</Label>
                <Input
                  type="time"
                  value={scheduleConfig.time || '15:30'}
                  onChange={e => setScheduleConfig({ ...scheduleConfig, time: e.target.value })}
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  {scheduleConfig.type === 'weekdays' ? '周一至周五' : '每天'}在此时间执行
                </p>
              </div>
            )}

            {scheduleConfig.type === 'interval' && (
              <div>
                <Label>执行间隔（分钟）</Label>
                <Select
                  value={(scheduleConfig.interval || 30).toString()}
                  onValueChange={val => setScheduleConfig({ ...scheduleConfig, interval: parseInt(val) })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="5">每 5 分钟</SelectItem>
                    <SelectItem value="10">每 10 分钟</SelectItem>
                    <SelectItem value="15">每 15 分钟</SelectItem>
                    <SelectItem value="30">每 30 分钟</SelectItem>
                    <SelectItem value="60">每小时</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {scheduleConfig.type === 'cron' && (
              <div>
                <Label>Cron 表达式</Label>
                <Input
                  value={scheduleConfig.cron || ''}
                  onChange={e => setScheduleConfig({ ...scheduleConfig, cron: e.target.value })}
                  placeholder="0 15 * * 1-5"
                  className="font-mono"
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  格式：分 时 日 月 周（如 0 15 * * 1-5 表示工作日 15:00）
                </p>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setScheduleDialogAgent(null)}>取消</Button>
              <Button onClick={saveSchedule}>保存</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
