import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useMemo, useState } from "react";
import {
  Ban,
  Check,
  Circle,
  Copy,
  Link2,
  Plus,
  Send,
  Trash2,
} from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { MAX_LINE_ITEM_AMOUNT_CENTS } from "@convex/paymentsPolicy";
import { DashboardHeader } from "@/components/DashboardHeader";
import {
  InvoiceStatusPill,
  type InvoiceStatus,
} from "@/components/invoices/InvoiceStatusPill";
import {
  SoftCard,
  SoftPage,
  softFieldLabel,
} from "@/components/soft";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { friendlyError } from "@/lib/friendlyError";
import {
  formatUsdCents,
  parseUsdDollarsToCents,
  usdCentsToInputValue,
} from "@/lib/money";
import { publicInvoiceUrl } from "@/lib/publicUrl";
import {
  invoicePath,
  teamHomePath,
  teamInvoicesPath,
} from "@/lib/routes";
import { seoHead } from "@/lib/seo";
import { cn } from "@/lib/utils";
import { useInvoiceDetailData } from "./-invoices.data";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";

type InvoiceDetail = NonNullable<
  FunctionReturnType<typeof api.invoices.get>
> & { payToken?: string };

type MilestoneDraft = {
  id: string;
  label: string;
  amount: string;
  dueDate: string;
};

type InvoiceDraft = {
  title: string;
  clientEmail: string;
  clientLabel: string;
  note: string;
  milestones: MilestoneDraft[];
};

type FormErrors = Record<string, string>;

type ValidMilestone = {
  id: string;
  label: string;
  amountCents: number;
  dueAt?: number;
};

export const Route = createFileRoute(
  "/dashboard/$teamSlug/invoices_/$invoiceId",
)({
  head: () =>
    seoHead({
      title: "Invoice",
      description: "Manage a client invoice.",
      path: "/dashboard",
      noIndex: true,
    }),
  component: InvoiceDetailRoute,
});

function InvoiceDetailRoute() {
  const { teamSlug, invoiceId: rawInvoiceId } = Route.useParams();
  const isNew = rawInvoiceId === "new";
  const invoiceId = isNew ? null : (rawInvoiceId as Id<"invoices">);
  const { context, invoice } = useInvoiceDetailData(teamSlug, invoiceId);

  if (context === undefined || (!isNew && invoice === undefined)) {
    return <InvoiceDetailSkeleton />;
  }

  if (!context) {
    return <InvoiceDetailMessage message="Workspace not found." />;
  }

  if (isNew) {
    if (context.team.role === "viewer") {
      return <InvoiceDetailMessage message="Editor access required." />;
    }
    return (
      <InvoiceDetailShell
        teamSlug={teamSlug}
        teamName={context.team.name}
        title="New invoice"
      >
        <InvoiceEditor
          key="new"
          teamId={context.team._id}
          teamSlug={teamSlug}
          invoice={null}
          canManage
        />
      </InvoiceDetailShell>
    );
  }

  if (!invoice || invoice.teamId !== context.team._id) {
    return <InvoiceDetailMessage message="Invoice not found." />;
  }

  return (
    <InvoiceDetailShell
      teamSlug={teamSlug}
      teamName={context.team.name}
      title={invoice.title}
    >
      <InvoiceEditor
        key={invoice._id}
        teamId={context.team._id}
        teamSlug={teamSlug}
        invoice={invoice as InvoiceDetail}
        canManage={context.team.role !== "viewer"}
      />
    </InvoiceDetailShell>
  );
}

function InvoiceDetailShell({
  teamSlug,
  teamName,
  title,
  children,
}: {
  teamSlug: string;
  teamName: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col">
      <DashboardHeader
        paths={[
          { label: teamName, href: teamHomePath(teamSlug) },
          { label: "Invoices", href: teamInvoicesPath(teamSlug) },
          { label: title },
        ]}
      />
      {children}
    </div>
  );
}

function InvoiceEditor({
  teamId,
  teamSlug,
  invoice,
  canManage,
}: {
  teamId: Id<"teams">;
  teamSlug: string;
  invoice: InvoiceDetail | null;
  canManage: boolean;
}) {
  const navigate = useNavigate();
  const createInvoice = useMutation(api.invoices.create);
  const updateInvoice = useMutation(api.invoices.update);
  const sendInvoice = useMutation(api.invoices.send);
  const voidInvoice = useMutation(api.invoices.voidInvoice);
  const revokePayLink = useMutation(api.invoices.revokePayLink);
  const confirmDialog = useConfirmDialog();
  const [form, setForm] = useState<InvoiceDraft>(() => draftFromInvoice(invoice));
  const [templateTotal, setTemplateTotal] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [busy, setBusy] = useState<
    "save" | "send" | "void" | "revoke" | null
  >(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const isDraft = invoice === null || invoice.status === "draft";
  const isEditable = isDraft && canManage;
  const shownTotalCents = useMemo(
    () =>
      form.milestones.reduce((sum, milestone) => {
        const cents = parseUsdDollarsToCents(milestone.amount);
        return sum + (cents && cents > 0 ? cents : 0);
      }, 0),
    [form.milestones],
  );
  const hasPaidMilestone = invoice?.milestones.some(
    (milestone) => milestone.paidAt !== undefined,
  );
  const canVoid = Boolean(
    invoice &&
      canManage &&
      invoice.status !== "draft" &&
      invoice.status !== "paid" &&
      invoice.status !== "void" &&
      !hasPaidMilestone,
  );
  const payUrl = invoice?.payToken
    ? publicInvoiceUrl(invoice.payToken)
    : null;
  const usesDefaultTemplate =
    invoice === null &&
    form.milestones.length === 2 &&
    form.milestones[0]?.id === "deposit" &&
    form.milestones[1]?.id === "delivery";

  const updateField = (field: keyof Omit<InvoiceDraft, "milestones">, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    clearError(field);
  };

  const updateMilestone = (
    id: string,
    field: keyof Omit<MilestoneDraft, "id">,
    value: string,
  ) => {
    setForm((current) => ({
      ...current,
      milestones: current.milestones.map((milestone) =>
        milestone.id === id ? { ...milestone, [field]: value } : milestone,
      ),
    }));
    if (field === "amount") setTemplateTotal("");
    clearError(`milestone.${id}.${field}`);
  };

  const clearError = (field: string) => {
    setErrors((current) => {
      if (!(field in current) && !("form" in current)) return current;
      const next = { ...current };
      delete next[field];
      delete next.form;
      return next;
    });
  };

  const addMilestone = () => {
    const id = `milestone-${globalThis.crypto.randomUUID()}`;
    setForm((current) => ({
      ...current,
      milestones: [
        ...current.milestones,
        { id, label: "", amount: "", dueDate: "" },
      ],
    }));
    setTemplateTotal("");
  };

  const removeMilestone = (id: string) => {
    setForm((current) => ({
      ...current,
      milestones: current.milestones.filter(
        (milestone) => milestone.id !== id,
      ),
    }));
    setTemplateTotal("");
  };

  const applyTemplateTotal = (value: string) => {
    setTemplateTotal(value);
    clearError("templateTotal");
    const totalCents = parseUsdDollarsToCents(value);
    if (totalCents === null || totalCents < 2) return;
    const depositCents = Math.floor(totalCents / 2);
    const deliveryCents = totalCents - depositCents;
    setForm((current) => ({
      ...current,
      milestones: current.milestones.map((milestone, index) => {
        if (index === 0) {
          return { ...milestone, amount: usdCentsToInputValue(depositCents) };
        }
        if (index === 1) {
          return { ...milestone, amount: usdCentsToInputValue(deliveryCents) };
        }
        return milestone;
      }),
    }));
    clearError("milestone.deposit.amount");
    clearError("milestone.delivery.amount");
  };

  const persist = async () => {
    const validation = validateDraft(form, usesDefaultTemplate ? templateTotal : "");
    if (!validation.milestones) {
      setErrors(validation.errors);
      return;
    }

    setErrors({});
    setNotice(null);
    setBusy("save");
    try {
      if (!invoice) {
        const createdId = await createInvoice({
          teamId,
          clientEmail: form.clientEmail.trim(),
          clientLabel: form.clientLabel.trim() || undefined,
          title: form.title.trim(),
          currency: "usd",
          milestones: validation.milestones,
          note: form.note.trim() || undefined,
        });
        await navigate({
          to: invoicePath(teamSlug, createdId),
          replace: true,
        });
        return;
      }

      await updateInvoice({
        invoiceId: invoice._id,
        clientEmail: form.clientEmail.trim(),
        clientLabel: form.clientLabel.trim() || null,
        title: form.title.trim(),
        currency: "usd",
        milestones: validation.milestones,
        note: form.note.trim() || null,
      });
      setNotice("Saved.");
    } catch (error) {
      setErrors({ form: friendlyError(error, "Invoice could not be saved.") });
    } finally {
      setBusy(null);
    }
  };

  const send = async () => {
    if (!invoice) return;
    const validation = validateDraft(form, "");
    if (!validation.milestones) {
      setErrors(validation.errors);
      return;
    }

    setErrors({});
    setNotice(null);
    setBusy("send");
    try {
      await updateInvoice({
        invoiceId: invoice._id,
        clientEmail: form.clientEmail.trim(),
        clientLabel: form.clientLabel.trim() || null,
        title: form.title.trim(),
        currency: "usd",
        milestones: validation.milestones,
        note: form.note.trim() || null,
      });
      await sendInvoice({ invoiceId: invoice._id });
      setNotice("Sent.");
    } catch (error) {
      setErrors({ form: friendlyError(error, "Invoice could not be sent.") });
    } finally {
      setBusy(null);
    }
  };

  const voidCurrentInvoice = async () => {
    if (!invoice) return;
    await confirmDialog({
      title: "Void invoice",
      description: "This invoice will no longer accept payments.",
      confirmLabel: "Void",
      variant: "destructive",
      action: async () => {
        setErrors({});
        setNotice(null);
        setBusy("void");
        try {
          await voidInvoice({ invoiceId: invoice._id });
          setNotice("Voided.");
        } finally {
          setBusy(null);
        }
      },
      errorMessage: (error) =>
        friendlyError(error, "Invoice could not be voided."),
    });
  };

  const revokeCurrentPayLink = async () => {
    if (!invoice) return;
    await confirmDialog({
      title: "Revoke link",
      description: "This pay link will stop working.",
      confirmLabel: "Revoke",
      variant: "destructive",
      action: async () => {
        setErrors({});
        setNotice(null);
        setBusy("revoke");
        try {
          await revokePayLink({ invoiceId: invoice._id });
          setNotice("Link revoked.");
        } finally {
          setBusy(null);
        }
      },
      errorMessage: (error) => friendlyError(error, "Link could not be revoked."),
    });
  };

  const copyPayLink = async () => {
    if (!payUrl) return;
    try {
      await navigator.clipboard.writeText(payUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch (error) {
      setErrors({ form: friendlyError(error, "Link could not be copied.") });
    }
  };

  const pageTitle = invoice ? form.title || "Invoice" : "New invoice";
  const actions = isEditable ? (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {invoice ? (
        <>
          <Button
            type="button"
            variant="outline"
            disabled={busy !== null}
            onClick={() => void persist()}
          >
            {busy === "save" ? "Saving" : "Save"}
          </Button>
          <Button
            type="button"
            disabled={busy !== null}
            onClick={() => void send()}
          >
            <Send />
            {busy === "send" ? "Sending" : "Send"}
          </Button>
        </>
      ) : (
        <Button
          type="button"
          disabled={busy !== null}
          onClick={() => void persist()}
        >
          {busy === "save" ? "Creating" : "Create draft"}
        </Button>
      )}
    </div>
  ) : canVoid ? (
    <Button
      type="button"
      variant="destructive"
      disabled={busy !== null}
      onClick={() => void voidCurrentInvoice()}
    >
      <Ban />
      {busy === "void" ? "Voiding" : "Void"}
    </Button>
  ) : null;

  return (
    <SoftPage title={pageTitle} aside={actions}>
      {errors.form ? <InvoiceNotice kind="error">{errors.form}</InvoiceNotice> : null}
      {notice ? <InvoiceNotice kind="success">{notice}</InvoiceNotice> : null}

      {isEditable ? (
        <DraftInvoiceForm
          form={form}
          errors={errors}
          totalCents={shownTotalCents}
          templateTotal={templateTotal}
          usesDefaultTemplate={usesDefaultTemplate}
          onFieldChange={updateField}
          onMilestoneChange={updateMilestone}
          onTemplateTotalChange={applyTemplateTotal}
          onAddMilestone={addMilestone}
          onRemoveMilestone={removeMilestone}
        />
      ) : invoice ? (
        <ReadOnlyInvoice
          invoice={invoice}
          payUrl={payUrl}
          copied={copied}
          revokeBusy={busy === "revoke"}
          canRevoke={canManage && invoice.status !== "void"}
          onCopy={() => void copyPayLink()}
          onRevoke={() => void revokeCurrentPayLink()}
        />
      ) : null}
    </SoftPage>
  );
}

function DraftInvoiceForm({
  form,
  errors,
  totalCents,
  templateTotal,
  usesDefaultTemplate,
  onFieldChange,
  onMilestoneChange,
  onTemplateTotalChange,
  onAddMilestone,
  onRemoveMilestone,
}: {
  form: InvoiceDraft;
  errors: FormErrors;
  totalCents: number;
  templateTotal: string;
  usesDefaultTemplate: boolean;
  onFieldChange: (
    field: keyof Omit<InvoiceDraft, "milestones">,
    value: string,
  ) => void;
  onMilestoneChange: (
    id: string,
    field: keyof Omit<MilestoneDraft, "id">,
    value: string,
  ) => void;
  onTemplateTotalChange: (value: string) => void;
  onAddMilestone: () => void;
  onRemoveMilestone: (id: string) => void;
}) {
  return (
    <>
      <SoftCard aria-labelledby="details-heading">
        <h2 id="details-heading" className="text-base font-semibold leading-[22px]">
          Details
        </h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <InvoiceField
            label="Title"
            error={errors.title}
            className="sm:col-span-2"
          >
            <Input
              value={form.title}
              onChange={(event) => onFieldChange("title", event.target.value)}
              placeholder="Project invoice"
              aria-invalid={Boolean(errors.title)}
            />
          </InvoiceField>
          <InvoiceField label="Client email" error={errors.clientEmail}>
            <Input
              type="email"
              value={form.clientEmail}
              onChange={(event) =>
                onFieldChange("clientEmail", event.target.value)
              }
              placeholder="client@example.com"
              aria-invalid={Boolean(errors.clientEmail)}
            />
          </InvoiceField>
          <InvoiceField label="Client name" error={errors.clientLabel}>
            <Input
              value={form.clientLabel}
              onChange={(event) =>
                onFieldChange("clientLabel", event.target.value)
              }
              placeholder="Optional"
              aria-invalid={Boolean(errors.clientLabel)}
            />
          </InvoiceField>
          <InvoiceField
            label="Note"
            error={errors.note}
            className="sm:col-span-2"
          >
            <Textarea
              value={form.note}
              onChange={(event) => onFieldChange("note", event.target.value)}
              placeholder="Optional"
              aria-invalid={Boolean(errors.note)}
            />
          </InvoiceField>
        </div>
      </SoftCard>

      <SoftCard aria-labelledby="schedule-heading">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 id="schedule-heading" className="text-base font-semibold leading-[22px]">
            Schedule
          </h2>
          {usesDefaultTemplate ? (
            <InvoiceField
              label="50/50 total"
              error={errors.templateTotal}
              className="w-full sm:w-48"
            >
              <MoneyInput
                value={templateTotal}
                onChange={onTemplateTotalChange}
                ariaInvalid={Boolean(errors.templateTotal)}
              />
            </InvoiceField>
          ) : null}
        </div>

        <div className="mt-5 space-y-3">
          {form.milestones.map((milestone, index) => (
            <div
              key={milestone.id}
              className="grid gap-3 rounded-[11px] border border-[#E8E8EC] bg-[#FAFAFA] p-4 sm:grid-cols-[minmax(0,1fr)_160px_160px_40px] sm:items-start"
            >
              <InvoiceField
                label={`Milestone ${index + 1}`}
                error={errors[`milestone.${milestone.id}.label`]}
              >
                <Input
                  value={milestone.label}
                  onChange={(event) =>
                    onMilestoneChange(
                      milestone.id,
                      "label",
                      event.target.value,
                    )
                  }
                  placeholder="Milestone"
                  aria-invalid={Boolean(
                    errors[`milestone.${milestone.id}.label`],
                  )}
                />
              </InvoiceField>
              <InvoiceField
                label="Amount"
                error={errors[`milestone.${milestone.id}.amount`]}
              >
                <MoneyInput
                  value={milestone.amount}
                  onChange={(value) =>
                    onMilestoneChange(milestone.id, "amount", value)
                  }
                  ariaInvalid={Boolean(
                    errors[`milestone.${milestone.id}.amount`],
                  )}
                />
              </InvoiceField>
              <InvoiceField
                label="Due"
                error={errors[`milestone.${milestone.id}.dueDate`]}
              >
                <Input
                  type="date"
                  value={milestone.dueDate}
                  onChange={(event) =>
                    onMilestoneChange(
                      milestone.id,
                      "dueDate",
                      event.target.value,
                    )
                  }
                  aria-invalid={Boolean(
                    errors[`milestone.${milestone.id}.dueDate`],
                  )}
                />
              </InvoiceField>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="mt-[22px] h-10 w-10 text-[#6E6E73] hover:text-[#D8434F]"
                disabled={form.milestones.length === 1}
                onClick={() => onRemoveMilestone(milestone.id)}
                aria-label={`Remove ${milestone.label || `milestone ${index + 1}`}`}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
        </div>

        {errors.milestones ? (
          <p className="mt-3 text-[13px] leading-[18px] text-[#D8434F]">
            {errors.milestones}
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-4 border-t border-[#E8E8EC] pt-4">
          <Button type="button" variant="outline" onClick={onAddMilestone}>
            <Plus />
            Add milestone
          </Button>
          <div className="text-right">
            <div className="font-['Geist_Mono',system-ui,sans-serif] text-[11px] font-medium uppercase tracking-widest text-[#A0A0A5]">
              Total
            </div>
            <div className="mt-1 text-lg font-semibold tabular-nums text-[#131315]">
              {formatUsdCents(totalCents)}
            </div>
            <p className="mt-1 text-[13px] text-[#6E6E73]">
              You receive this. Buyer pays the Snip fee on top.
            </p>
          </div>
        </div>
      </SoftCard>
    </>
  );
}

function ReadOnlyInvoice({
  invoice,
  payUrl,
  copied,
  revokeBusy,
  canRevoke,
  onCopy,
  onRevoke,
}: {
  invoice: InvoiceDetail;
  payUrl: string | null;
  copied: boolean;
  revokeBusy: boolean;
  canRevoke: boolean;
  onCopy: () => void;
  onRevoke: () => void;
}) {
  const totalCents = invoice.milestones.reduce(
    (sum, milestone) => sum + milestone.amountCents,
    0,
  );
  const paidCents = invoice.milestones.reduce(
    (sum, milestone) =>
      sum + (milestone.paidAt !== undefined ? milestone.amountCents : 0),
    0,
  );
  const amountClass =
    invoice.status === "void" ? "text-[#A0A0A5] line-through" : "text-[#131315]";

  return (
    <>
      <SoftCard aria-labelledby="summary-heading">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 id="summary-heading" className="text-base font-semibold leading-[22px]">
              {invoice.title}
            </h2>
            <p className="mt-1 text-sm text-[#6E6E73]">
              {invoice.clientLabel || invoice.clientEmail}
            </p>
          </div>
          <InvoiceStatusPill status={invoice.status as InvoiceStatus} />
        </div>
        <div className="mt-5 grid gap-4 border-t border-[#F1F1F3] pt-4 sm:grid-cols-3">
          <SummaryValue label="Email" value={invoice.clientEmail} />
          <SummaryValue label="Total" value={formatUsdCents(totalCents)} money />
          <SummaryValue label="Paid" value={formatUsdCents(paidCents)} money />
        </div>
      </SoftCard>

      {invoice.status !== "draft" ? (
        <SoftCard aria-labelledby="pay-link-heading">
          <h2 id="pay-link-heading" className="text-base font-semibold leading-[22px]">
            Pay link
          </h2>
          {payUrl ? (
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative min-w-0 flex-1">
                <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#A0A0A5]" />
                <Input
                  readOnly
                  value={payUrl}
                  className="pl-9 text-[#6E6E73]"
                  aria-label="Pay link"
                />
              </div>
              <Button type="button" variant="outline" onClick={onCopy}>
                {copied ? <Check /> : <Copy />}
                {copied ? "Copied" : "Copy"}
              </Button>
              {canRevoke ? (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={revokeBusy}
                  onClick={onRevoke}
                  className="text-[#D8434F] hover:bg-[#FFF5F5]"
                >
                  {revokeBusy ? "Revoking" : "Revoke"}
                </Button>
              ) : null}
            </div>
          ) : (
            <p className="mt-3 text-sm text-[#6E6E73]">Link revoked.</p>
          )}
        </SoftCard>
      ) : null}

      <SoftCard aria-labelledby="milestones-heading">
        <h2 id="milestones-heading" className="text-base font-semibold leading-[22px]">
          Schedule
        </h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] table-fixed text-left text-sm">
            <colgroup>
              <col className="w-[38%]" />
              <col className="w-[20%]" />
              <col className="w-[24%]" />
              <col className="w-[18%]" />
            </colgroup>
            <thead>
              <tr className="font-['Geist_Mono',system-ui,sans-serif] text-[11px] font-medium uppercase tracking-widest text-[#A0A0A5]">
                <th className="pb-2 font-medium">Milestone</th>
                <th className="pb-2 font-medium">Due</th>
                <th className="pb-2 font-medium">Status</th>
                <th className="pb-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoice.milestones.map((milestone) => (
                <tr key={milestone.id} className="border-t border-[#F1F1F3]">
                  <td className="py-3.5 pr-4 font-medium">{milestone.label}</td>
                  <td className="py-3.5 pr-4 text-[#6E6E73]">
                    {milestone.dueAt ? formatDate(milestone.dueAt) : "None"}
                  </td>
                  <td className="py-3.5 pr-4">
                    {milestone.paidAt ? (
                      <span className="inline-flex items-center gap-1.5 text-[#225B36]">
                        <Check className="h-3.5 w-3.5" />
                        Paid {formatDate(milestone.paidAt)}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-[#6E6E73]">
                        <Circle className="h-3.5 w-3.5" />
                        Unpaid
                      </span>
                    )}
                  </td>
                  <td className={cn("py-3.5 text-right tabular-nums", amountClass)}>
                    {formatUsdCents(milestone.amountCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-1 flex justify-end border-t border-[#E8E8EC] pt-4">
          <div className="text-right">
            <div className="font-['Geist_Mono',system-ui,sans-serif] text-[11px] font-medium uppercase tracking-widest text-[#A0A0A5]">
              You receive
            </div>
            <div className={cn("mt-1 text-lg font-semibold tabular-nums", amountClass)}>
              {formatUsdCents(totalCents)}
            </div>
            <p className="mt-1 text-[13px] text-[#6E6E73]">
              Buyer pays the Snip fee on top.
            </p>
          </div>
        </div>
      </SoftCard>

      {invoice.note ? (
        <SoftCard aria-labelledby="note-heading">
          <h2 id="note-heading" className="text-base font-semibold leading-[22px]">
            Note
          </h2>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-5 text-[#6E6E73]">
            {invoice.note}
          </p>
        </SoftCard>
      ) : null}
    </>
  );
}

function InvoiceField({
  label,
  error,
  className,
  children,
}: {
  label: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("block", className)}>
      <span className={softFieldLabel}>{label}</span>
      {children}
      {error ? (
        <span className="mt-1.5 block text-[13px] leading-[18px] text-[#D8434F]">
          {error}
        </span>
      ) : null}
    </label>
  );
}

function MoneyInput({
  value,
  onChange,
  ariaInvalid,
}: {
  value: string;
  onChange: (value: string) => void;
  ariaInvalid: boolean;
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[#6E6E73]">
        $
      </span>
      <Input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="0.00"
        className="pl-7 tabular-nums"
        aria-invalid={ariaInvalid}
      />
    </div>
  );
}

function SummaryValue({
  label,
  value,
  money = false,
}: {
  label: string;
  value: string;
  money?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="font-['Geist_Mono',system-ui,sans-serif] text-[11px] font-medium uppercase tracking-widest text-[#A0A0A5]">
        {label}
      </div>
      <div
        className={cn(
          "mt-1 truncate text-sm text-[#131315]",
          money && "tabular-nums",
        )}
        title={value}
      >
        {value}
      </div>
    </div>
  );
}

function InvoiceNotice({
  kind,
  children,
}: {
  kind: "success" | "error";
  children: React.ReactNode;
}) {
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      className={cn(
        "rounded-[11px] border px-4 py-3 text-sm",
        kind === "error"
          ? "border-[#E8B9BD] bg-[#FFF5F5] text-[#8A2B34]"
          : "border-[#BBE2CA] bg-[#F2FBF5] text-[#225B36]",
      )}
    >
      {children}
    </div>
  );
}

function InvoiceDetailSkeleton() {
  return (
    <div className="flex h-full flex-col">
      <DashboardHeader paths={[{ label: "Invoices" }]} />
      <SoftPage title="Invoice">
        <SoftCard className="space-y-3" aria-label="Loading invoice">
          <div className="h-10 animate-pulse rounded-[10px] bg-[#F1F1F3]" />
          <div className="h-28 animate-pulse rounded-[10px] bg-[#F1F1F3]" />
        </SoftCard>
      </SoftPage>
    </div>
  );
}

function InvoiceDetailMessage({ message }: { message: string }) {
  return (
    <div className="flex h-full flex-col">
      <DashboardHeader paths={[{ label: "Invoices" }]} />
      <SoftPage title="Invoice">
        <SoftCard>
          <p className="text-sm text-[#6E6E73]">{message}</p>
        </SoftCard>
      </SoftPage>
    </div>
  );
}

function draftFromInvoice(invoice: InvoiceDetail | null): InvoiceDraft {
  if (!invoice) {
    return {
      title: "",
      clientEmail: "",
      clientLabel: "",
      note: "",
      milestones: [
        { id: "deposit", label: "Deposit", amount: "", dueDate: "" },
        { id: "delivery", label: "Delivery", amount: "", dueDate: "" },
      ],
    };
  }

  return {
    title: invoice.title,
    clientEmail: invoice.clientEmail,
    clientLabel: invoice.clientLabel ?? "",
    note: invoice.note ?? "",
    milestones: invoice.milestones.map((milestone) => ({
      id: milestone.id,
      label: milestone.label,
      amount: usdCentsToInputValue(milestone.amountCents),
      dueDate: milestone.dueAt ? dateInputValue(milestone.dueAt) : "",
    })),
  };
}

function validateDraft(
  draft: InvoiceDraft,
  templateTotal: string,
): { errors: FormErrors; milestones: ValidMilestone[] | null } {
  const errors: FormErrors = {};
  const title = draft.title.trim();
  const email = draft.clientEmail.trim();
  const clientLabel = draft.clientLabel.trim();
  const note = draft.note.trim();

  if (!title) errors.title = "Title is required.";
  else if (title.length > 200) errors.title = "Maximum is 200 characters.";

  if (!email) errors.clientEmail = "Email is required.";
  else if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.clientEmail = "Enter a valid email.";
  }

  if (clientLabel.length > 160) {
    errors.clientLabel = "Maximum is 160 characters.";
  }
  if (note.length > 5_000) errors.note = "Maximum is 5,000 characters.";
  if (draft.milestones.length === 0) {
    errors.milestones = "Add a milestone.";
  }

  if (templateTotal) {
    const totalCents = parseUsdDollarsToCents(templateTotal);
    if (totalCents === null) {
      errors.templateTotal = "Enter a USD amount.";
    } else if (totalCents < 2) {
      errors.templateTotal = `${formatUsdCents(totalCents)} cannot split 50/50. Minimum is $0.02.`;
    }
  }

  const milestones: ValidMilestone[] = [];
  for (const milestone of draft.milestones) {
    const labelKey = `milestone.${milestone.id}.label`;
    const amountKey = `milestone.${milestone.id}.amount`;
    const dueKey = `milestone.${milestone.id}.dueDate`;
    const label = milestone.label.trim();
    const amountCents = parseUsdDollarsToCents(milestone.amount);

    if (!label) errors[labelKey] = "Label is required.";
    else if (label.length > 160) errors[labelKey] = "Maximum is 160 characters.";

    if (amountCents === null) {
      errors[amountKey] = milestone.amount.trim()
        ? "Enter a USD amount with up to 2 decimals."
        : "Amount is required.";
    } else if (amountCents <= 0) {
      errors[amountKey] = `Amount must be above $0.00. You entered ${formatUsdCents(amountCents)}.`;
    } else if (amountCents > MAX_LINE_ITEM_AMOUNT_CENTS) {
      errors[amountKey] = `Maximum is ${formatUsdCents(MAX_LINE_ITEM_AMOUNT_CENTS)}. You entered ${formatUsdCents(amountCents)}.`;
    }

    let dueAt: number | undefined;
    if (milestone.dueDate) {
      dueAt = new Date(`${milestone.dueDate}T12:00:00`).getTime();
      if (!Number.isSafeInteger(dueAt) || dueAt <= 0) {
        errors[dueKey] = "Enter a valid date.";
      }
    }

    if (label && amountCents !== null && amountCents > 0) {
      milestones.push({
        id: milestone.id,
        label,
        amountCents,
        dueAt,
      });
    }
  }

  return {
    errors,
    milestones: Object.keys(errors).length === 0 ? milestones : null,
  };
}

function dateInputValue(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
