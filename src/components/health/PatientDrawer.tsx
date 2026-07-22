import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { CalendarPlus, FileText, DollarSign } from "lucide-react";
import { Link } from "react-router-dom";
import {
  Patient, BLOOD_TYPES, fullName, BRL, formatPhone,
  APPOINTMENT_STATUS_LABELS, APPOINTMENT_STATUS_BADGE, AppointmentStatus,
  PAYMENT_STATUS_LABELS, PAYMENT_STATUS_BADGE,
} from "./types";

interface PatientDrawerProps {
  patientId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated?: () => void;
}

export function PatientDrawer({ patientId, open, onOpenChange, onUpdated }: PatientDrawerProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [appointments, setAppointments] = useState<any[]>([]);
  const [records, setRecords] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [otherActivities, setOtherActivities] = useState<any[]>([]);

  useEffect(() => {
    if (!open || !patientId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const [{ data: p }, apps, recs, pays, other] = await Promise.all([
          (supabase as any).from("patients").select("*").eq("id", patientId).maybeSingle(),
          (supabase as any)
            .from("activities")
            .select("id,title,due_date,appointment_status,appointment_type,duration_minutes")
            .eq("contact_id", patientId)
            .not("appointment_status", "is", null)
            .order("due_date", { ascending: false })
            .limit(50),
          (supabase as any)
            .from("medical_records")
            .select("id,created_at,is_draft,chief_complaint,follow_up_date")
            .eq("patient_id", patientId)
            .order("created_at", { ascending: false })
            .limit(50),
          (supabase as any)
            .from("payments")
            .select("id,procedure_name,amount,payment_method,status,paid_at,created_at")
            .eq("patient_id", patientId)
            .order("created_at", { ascending: false })
            .limit(50),
          (supabase as any)
            .from("activities")
            .select("id,title,due_date,type,completed_at")
            .eq("contact_id", patientId)
            .is("appointment_status", null)
            .order("due_date", { ascending: false })
            .limit(50),
        ]);
        if (cancelled) return;
        setPatient(p ?? null);
        setAppointments(apps.data ?? []);
        setRecords(recs.data ?? []);
        setPayments(pays.data ?? []);
        setOtherActivities(other.data ?? []);
      } catch (err: any) {
        toast({ title: "Erro ao carregar paciente", description: err?.message ?? String(err), variant: "destructive" });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, patientId, toast]);

  const updateField = <K extends keyof Patient>(key: K, value: Patient[K]) => {
    setPatient((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const handleSave = async () => {
    if (!patient) return;
    setSaving(true);
    try {
      const { error } = await (supabase as any)
        .from("patients")
        .update({
          first_name: patient.first_name,
          last_name: patient.last_name,
          email: patient.email,
          phone: patient.phone,
          cpf: patient.cpf,
          date_of_birth: patient.date_of_birth,
          blood_type: patient.blood_type,
          allergies: patient.allergies,
          health_plan: patient.health_plan,
          health_plan_number: patient.health_plan_number,
          emergency_contact_name: patient.emergency_contact_name,
          emergency_contact_phone: patient.emergency_contact_phone,
          address: patient.address,
          notes: patient.notes,
          status: patient.status,
        })
        .eq("id", patient.id);
      if (error) throw error;
      toast({ title: "Paciente atualizado" });
      onUpdated?.();
    } catch (err: any) {
      toast({ title: "Erro ao salvar", description: err?.message ?? String(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const totalPaid = payments.filter((p) => p.status === "paid").reduce((acc, p) => acc + Number(p.amount || 0), 0);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <Avatar className="h-12 w-12">
                <AvatarImage src={patient?.avatar_url ?? undefined} />
                <AvatarFallback>{(patient?.first_name ?? "?").charAt(0).toUpperCase()}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <SheetTitle className="truncate">{patient ? fullName(patient) : "Carregando…"}</SheetTitle>
                <SheetDescription className="flex items-center gap-2">
                  {patient && (
                    <Badge variant={patient.status === "active" ? "default" : "secondary"}>
                      {patient.status === "active" ? "Ativo" : "Inativo"}
                    </Badge>
                  )}
                  {patient?.phone && <span className="text-xs">{formatPhone(patient.phone)}</span>}
                </SheetDescription>
              </div>
            </div>
            <Button asChild size="sm" variant="default">
              <Link to={`/agenda?patient=${patientId ?? ""}`}>
                <CalendarPlus className="mr-2 h-4 w-4" /> Agendar consulta
              </Link>
            </Button>
          </div>
        </SheetHeader>

        {loading ? (
          <div className="py-10 text-center text-sm text-muted-foreground">Carregando…</div>
        ) : !patient ? (
          <div className="py-10 text-center text-sm text-muted-foreground">Paciente não encontrado.</div>
        ) : (
          <Tabs defaultValue="dados" className="mt-4">
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="dados">Dados</TabsTrigger>
              <TabsTrigger value="consultas">Consultas</TabsTrigger>
              <TabsTrigger value="prontuarios">Prontuários</TabsTrigger>
              <TabsTrigger value="pagamentos">Pagamentos</TabsTrigger>
              <TabsTrigger value="atividades">Atividades</TabsTrigger>
            </TabsList>

            <TabsContent value="dados" className="space-y-3 pt-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Primeiro nome</Label>
                  <Input value={patient.first_name} onChange={(e) => updateField("first_name", e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Sobrenome</Label>
                  <Input value={patient.last_name ?? ""} onChange={(e) => updateField("last_name", e.target.value || null)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Telefone</Label>
                  <Input value={patient.phone} onChange={(e) => updateField("phone", e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>CPF</Label>
                  <Input value={patient.cpf ?? ""} onChange={(e) => updateField("cpf", e.target.value || null)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Email</Label>
                  <Input value={patient.email ?? ""} onChange={(e) => updateField("email", e.target.value || null)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Data de nascimento</Label>
                  <Input type="date" value={patient.date_of_birth ?? ""} onChange={(e) => updateField("date_of_birth", e.target.value || null)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Tipo sanguíneo</Label>
                  <Select value={patient.blood_type ?? ""} onValueChange={(v) => updateField("blood_type", v || null)}>
                    <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {BLOOD_TYPES.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Status</Label>
                  <Select value={patient.status} onValueChange={(v) => updateField("status", v as Patient["status"])}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Ativo</SelectItem>
                      <SelectItem value="inactive">Inativo</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Convênio</Label>
                  <Input value={patient.health_plan ?? ""} onChange={(e) => updateField("health_plan", e.target.value || null)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Nº convênio</Label>
                  <Input value={patient.health_plan_number ?? ""} onChange={(e) => updateField("health_plan_number", e.target.value || null)} />
                </div>
                <div className="space-y-1.5 col-span-2">
                  <Label>Alergias</Label>
                  <Textarea rows={2} value={patient.allergies ?? ""} onChange={(e) => updateField("allergies", e.target.value || null)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Contato emergência (nome)</Label>
                  <Input value={patient.emergency_contact_name ?? ""} onChange={(e) => updateField("emergency_contact_name", e.target.value || null)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Contato emergência (telefone)</Label>
                  <Input value={patient.emergency_contact_phone ?? ""} onChange={(e) => updateField("emergency_contact_phone", e.target.value || null)} />
                </div>
                <div className="space-y-1.5 col-span-2">
                  <Label>Endereço</Label>
                  <Input value={patient.address ?? ""} onChange={(e) => updateField("address", e.target.value || null)} />
                </div>
                <div className="space-y-1.5 col-span-2">
                  <Label>Observações</Label>
                  <Textarea rows={3} value={patient.notes ?? ""} onChange={(e) => updateField("notes", e.target.value || null)} />
                </div>
              </div>
              <div className="flex justify-end">
                <Button onClick={handleSave} disabled={saving}>{saving ? "Salvando…" : "Salvar"}</Button>
              </div>
            </TabsContent>

            <TabsContent value="consultas" className="space-y-2 pt-4">
              {appointments.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma consulta registrada.</p>
              ) : (
                appointments.map((a) => (
                  <div key={a.id} className="flex items-center justify-between rounded-md border p-3 text-sm">
                    <div>
                      <p className="font-medium">{a.title || "Consulta"}</p>
                      <p className="text-xs text-muted-foreground">
                        {a.due_date ? new Date(a.due_date).toLocaleString("pt-BR") : "—"} · {a.duration_minutes ?? 30} min
                      </p>
                    </div>
                    <Badge className={APPOINTMENT_STATUS_BADGE[a.appointment_status as AppointmentStatus] ?? ""}>
                      {APPOINTMENT_STATUS_LABELS[a.appointment_status as AppointmentStatus] ?? a.appointment_status}
                    </Badge>
                  </div>
                ))
              )}
            </TabsContent>

            <TabsContent value="prontuarios" className="space-y-2 pt-4">
              <div className="flex justify-end">
                <Button asChild size="sm" variant="outline">
                  <Link to={`/records?patient=${patient.id}`}>
                    <FileText className="mr-2 h-4 w-4" /> Novo prontuário
                  </Link>
                </Button>
              </div>
              {records.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum prontuário ainda.</p>
              ) : (
                records.map((r) => (
                  <Link key={r.id} to={`/records/${r.id}`} className="block rounded-md border p-3 text-sm hover:bg-accent/40">
                    <div className="flex items-center justify-between">
                      <p className="font-medium truncate">{r.chief_complaint || "Sem queixa registrada"}</p>
                      <Badge variant={r.is_draft ? "secondary" : "default"}>{r.is_draft ? "Rascunho" : "Finalizado"}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {new Date(r.created_at).toLocaleString("pt-BR")}
                      {r.follow_up_date && <> · retorno {new Date(r.follow_up_date).toLocaleDateString("pt-BR")}</>}
                    </p>
                  </Link>
                ))
              )}
            </TabsContent>

            <TabsContent value="pagamentos" className="space-y-2 pt-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Total pago</span>
                <span className="font-semibold">{BRL.format(totalPaid)}</span>
              </div>
              {payments.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum pagamento registrado.</p>
              ) : (
                payments.map((p) => (
                  <div key={p.id} className="flex items-center justify-between rounded-md border p-3 text-sm">
                    <div>
                      <p className="font-medium">{p.procedure_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {p.paid_at ? new Date(p.paid_at).toLocaleDateString("pt-BR") : new Date(p.created_at).toLocaleDateString("pt-BR")}
                        {" · "}{p.payment_method}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">{BRL.format(Number(p.amount))}</p>
                      <Badge className={PAYMENT_STATUS_BADGE[p.status] ?? ""}>
                        {PAYMENT_STATUS_LABELS[p.status] ?? p.status}
                      </Badge>
                    </div>
                  </div>
                ))
              )}
            </TabsContent>

            <TabsContent value="atividades" className="space-y-2 pt-4">
              {otherActivities.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma atividade.</p>
              ) : (
                otherActivities.map((a) => (
                  <div key={a.id} className="flex items-center justify-between rounded-md border p-3 text-sm">
                    <div>
                      <p className="font-medium">{a.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {a.type ?? "Atividade"} · {a.due_date ? new Date(a.due_date).toLocaleString("pt-BR") : "Sem data"}
                      </p>
                    </div>
                    <Badge variant={a.completed_at ? "default" : "secondary"}>
                      {a.completed_at ? "Concluída" : "Pendente"}
                    </Badge>
                  </div>
                ))
              )}
            </TabsContent>
          </Tabs>
        )}
      </SheetContent>
    </Sheet>
  );
}
