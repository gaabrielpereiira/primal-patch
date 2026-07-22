import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/hooks/useOrg";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Kanban, Clock, Stethoscope } from "lucide-react";
import { EmptyState } from "@/components/crm/EmptyState";
import { APPOINTMENT_STATUS_LABELS, AppointmentStatus } from "@/components/health/types";

type Pipeline = { id: string; name: string; currency: string };
type Stage = { id: string; pipeline_id: string; name: string; position: number; probability: number };
type Appointment = {
  id: string;
  title: string;
  due_date: string | null;
  appointment_status: AppointmentStatus | null;
  appointment_type: string | null;
  duration_minutes: number | null;
  contact_id: string | null;
  professional_id: string | null;
  value?: number;
};
type PatientLite = { id: string; first_name: string | null; last_name: string | null };
type ProfessionalLite = { id: string; name: string };

const STAGE_COLORS = [
  "border-t-sky-500",
  "border-t-violet-500",
  "border-t-amber-500",
  "border-t-emerald-500",
  "border-t-pink-500",
  "border-t-indigo-500",
];

function formatCurrency(value: number, currency = "BRL") {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value);
}

export default function Pipeline() {
  const { orgId } = useOrg();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [patients, setPatients] = useState<Record<string, PatientLite>>({});
  const [professionals, setProfessionals] = useState<Record<string, ProfessionalLite>>({});
  const [selected, setSelected] = useState<Appointment | null>(null);

  const currentPipeline = useMemo(
    () => pipelines.find((p) => p.id === selectedPipelineId) ?? null,
    [pipelines, selectedPipelineId],
  );

  const fetchAll = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const { data: pipes, error: pErr } = await supabase
        .from("pipelines")
        .select("id,name,currency,is_default")
        .eq("org_id", orgId)
        .order("is_default", { ascending: false })
        .order("name");
      if (pErr) throw pErr;
      const list = (pipes ?? []) as Pipeline[];
      setPipelines(list);

      const chosen = selectedPipelineId && list.some((p) => p.id === selectedPipelineId)
        ? selectedPipelineId
        : list[0]?.id ?? null;
      setSelectedPipelineId(chosen);

      if (!chosen) {
        setStages([]); setAppointments([]); setPatients({}); setProfessionals({});
        return;
      }

      const { data: stg } = await supabase
        .from("pipeline_stages")
        .select("id,pipeline_id,name,position,probability")
        .eq("pipeline_id", chosen)
        .order("position");
      setStages((stg ?? []) as Stage[]);

      const { data: apps } = await (supabase as any)
        .from("activities")
        .select("id,title,due_date,appointment_status,appointment_type,duration_minutes,contact_id,professional_id")
        .eq("org_id", orgId)
        .not("appointment_status", "is", null)
        .order("due_date", { ascending: false })
        .limit(500);
      const appsList = (apps ?? []) as Appointment[];

      // Pagamentos por consulta (valor)
      const appointmentIds = appsList.map((a) => a.id);
      const valueByActivity = new Map<string, number>();
      if (appointmentIds.length) {
        const { data: pays } = await (supabase as any)
          .from("payments")
          .select("activity_id,amount")
          .in("activity_id", appointmentIds);
        for (const p of (pays ?? []) as { activity_id: string; amount: number }[]) {
          if (!p.activity_id) continue;
          valueByActivity.set(p.activity_id, (valueByActivity.get(p.activity_id) ?? 0) + Number(p.amount || 0));
        }
      }
      setAppointments(appsList.map((a) => ({ ...a, value: valueByActivity.get(a.id) ?? 0 })));

      const patientIds = Array.from(new Set(appsList.map((a) => a.contact_id).filter(Boolean) as string[]));
      if (patientIds.length) {
        const { data: pts } = await (supabase as any)
          .from("patients").select("id,first_name,last_name").in("id", patientIds);
        setPatients(Object.fromEntries(((pts ?? []) as PatientLite[]).map((p) => [p.id, p])));
      } else setPatients({});

      const profIds = Array.from(new Set(appsList.map((a) => a.professional_id).filter(Boolean) as string[]));
      if (profIds.length) {
        const { data: profs } = await (supabase as any)
          .from("professionals").select("id,name").in("id", profIds);
        setProfessionals(Object.fromEntries(((profs ?? []) as ProfessionalLite[]).map((p) => [p.id, p])));
      } else setProfessionals({});
    } catch (err: any) {
      toast({ title: "Erro ao carregar pipeline", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, selectedPipelineId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Mapeia o nome da etapa do pipeline ao status de consulta correspondente
  const stageToStatus = useMemo(() => {
    const map = new Map<string, AppointmentStatus>();
    const reverse = Object.entries(APPOINTMENT_STATUS_LABELS) as [AppointmentStatus, string][];
    for (const s of stages) {
      const match = reverse.find(([, label]) => label.toLowerCase() === s.name.toLowerCase());
      if (match) map.set(s.id, match[0]);
    }
    return map;
  }, [stages]);

  const appointmentsByStage = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    for (const s of stages) map.set(s.id, []);
    for (const a of appointments) {
      for (const s of stages) {
        if (stageToStatus.get(s.id) === a.appointment_status) {
          map.get(s.id)!.push(a);
          break;
        }
      }
    }
    return map;
  }, [stages, appointments, stageToStatus]);

  const currency = currentPipeline?.currency ?? "BRL";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl sm:text-2xl font-bold tracking-tight">
            <Kanban className="h-6 w-6 text-primary" /> Pipeline
          </h1>
          <p className="text-sm text-muted-foreground">
            Visualize a jornada dos pacientes por etapas do funil.
          </p>
        </div>
        {pipelines.length > 0 && (
          <Select value={selectedPipelineId ?? undefined} onValueChange={(v) => setSelectedPipelineId(v)}>
            <SelectTrigger className="w-full sm:w-64">
              <SelectValue placeholder="Selecionar pipeline" />
            </SelectTrigger>
            <SelectContent>
              {pipelines.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-64 animate-pulse rounded-lg bg-muted/40" />
          ))}
        </div>
      ) : pipelines.length === 0 ? (
        <EmptyState
          icon={<Kanban className="h-6 w-6 text-muted-foreground" />}
          title="Nenhum pipeline configurado"
          description="Crie um pipeline em Configurações para começar a acompanhar a jornada dos pacientes."
        />
      ) : stages.length === 0 ? (
        <EmptyState
          icon={<Kanban className="h-6 w-6 text-muted-foreground" />}
          title="Pipeline sem etapas"
          description="Adicione etapas a este pipeline em Configurações para visualizar a jornada."
        />
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-2">
          {stages.map((stage, idx) => {
            const stageItems = appointmentsByStage.get(stage.id) ?? [];
            const total = stageItems.reduce((sum, a) => sum + (a.value ?? 0), 0);
            return (
              <div key={stage.id} className="w-72 shrink-0">
                <Card className={`border-t-4 ${STAGE_COLORS[idx % STAGE_COLORS.length]} bg-muted/30 p-3`}>
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold">{stage.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {stageItems.length} {stageItems.length === 1 ? "consulta" : "consultas"}
                      </p>
                    </div>
                    <Badge variant="secondary" className="text-xs">
                      {formatCurrency(total, currency)}
                    </Badge>
                  </div>
                  <div className="space-y-2 max-h-[calc(100vh-280px)] overflow-y-auto">
                    {stageItems.length === 0 ? (
                      <p className="py-6 text-center text-xs text-muted-foreground">
                        Sem consultas nesta etapa
                      </p>
                    ) : (
                      stageItems.map((a) => {
                        const patient = a.contact_id ? patients[a.contact_id] : null;
                        const prof = a.professional_id ? professionals[a.professional_id] : null;
                        const patientName = patient ? [patient.first_name, patient.last_name].filter(Boolean).join(" ") : "";
                        return (
                          <button
                            key={a.id}
                            onClick={() => setSelected(a)}
                            className="w-full rounded-md border bg-background p-3 text-left transition-colors hover:bg-accent"
                          >
                            <p className="text-sm font-medium line-clamp-2">{patientName || a.title}</p>
                            {a.due_date && (
                              <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                                <Clock className="h-3 w-3" /> {new Date(a.due_date).toLocaleString("pt-BR")}
                              </p>
                            )}
                            {prof?.name && (
                              <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                                <Stethoscope className="h-3 w-3" /> {prof.name}
                              </p>
                            )}
                            <div className="mt-2 flex items-center justify-between">
                              <span className="flex items-center gap-1 text-xs font-medium text-primary">
                                {a.value ? formatCurrency(a.value, currency) : (a.appointment_type ?? "Consulta")}
                              </span>
                              {a.duration_minutes && (
                                <span className="text-[10px] text-muted-foreground">
                                  {a.duration_minutes} min
                                </span>
                              )}
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                </Card>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{selected?.title}</DialogTitle>
            <DialogDescription>Detalhes da consulta</DialogDescription>
          </DialogHeader>
          {selected && (
            <div className="space-y-3 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Paciente</span><span>{selected.contact_id && patients[selected.contact_id] ? [patients[selected.contact_id].first_name, patients[selected.contact_id].last_name].filter(Boolean).join(" ") : "—"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Médico</span><span>{selected.professional_id ? professionals[selected.professional_id]?.name ?? "—" : "—"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Status</span><span>{selected.appointment_status ? APPOINTMENT_STATUS_LABELS[selected.appointment_status] : "—"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Tipo</span><span>{selected.appointment_type ?? "—"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Data</span><span>{selected.due_date ? new Date(selected.due_date).toLocaleString("pt-BR") : "—"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Duração</span><span>{selected.duration_minutes ? `${selected.duration_minutes} min` : "—"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Valor</span><span className="font-medium">{formatCurrency(selected.value ?? 0, currency)}</span></div>
              <div className="flex justify-end pt-2">
                <Button variant="outline" onClick={() => setSelected(null)}>Fechar</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}