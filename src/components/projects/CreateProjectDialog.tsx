"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { useNavigate } from "@tanstack/react-router";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { projectPath } from "@/lib/routes";

/**
 * Lightweight "create a project" dialog used by the sidebar's
 * "+ New project" button and the home page header. Bound to a
 * specific team (caller picks which one — usually the user's
 * first team, since teams are largely invisible in the new UI).
 */
interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teamId: Id<"teams">;
  teamSlug: string;
}

export function CreateProjectDialog({
  open,
  onOpenChange,
  teamId,
  teamSlug,
}: Props) {
  const navigate = useNavigate();
  const createProject = useMutation(api.projects.create);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const projectId = await createProject({ teamId, name: name.trim() });
      onOpenChange(false);
      setName("");
      navigate({ to: projectPath(teamSlug, projectId as Id<"projects">) });
    } catch (e) {
      // Drop the raw `[CONVEX M(projects:create)] …` text in favor of a
      // single human-readable line. Typed ConvexError payloads (e.data)
      // get a tailored prompt; everything else falls back to a generic
      // failure message.
      const data =
        typeof e === "object" && e !== null && "data" in e
          ? ((e as { data: unknown }).data as
              | { code?: string; message?: string }
              | undefined)
          : undefined;
      if (data?.code === "storage_quota_exceeded") {
        setError(
          data.message ??
            "Storage limit reached. Upgrade in Billing & usage to keep creating.",
        );
      } else {
        setError("Couldn't create the project. Try again.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>
            Projects hold videos, contracts, and team review threads.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => void submit(e)} className="space-y-3 pt-2">
          <label className="block">
            <div className="text-[10px] uppercase tracking-[0.15em] text-[#888] font-bold mb-1">
              Project name
            </div>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Q4 brand launch"
              disabled={busy}
            />
          </label>
          {error ? (
            <div className="text-xs text-[#dc2626] font-bold">{error}</div>
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
