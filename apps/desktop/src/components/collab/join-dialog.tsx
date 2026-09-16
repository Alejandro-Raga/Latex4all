import { useState } from "react";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useCollabStore } from "@/stores/collab-store";

export function JoinDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const displayName = useCollabStore((s) => s.displayName);
  const setDisplayName = useCollabStore((s) => s.setDisplayName);
  const join = useCollabStore((s) => s.join);
  const status = useCollabStore((s) => s.status);
  const [invite, setInvite] = useState("");
  const joining = status === "connecting";

  const handleJoin = async () => {
    try {
      await join(invite);
      setInvite("");
      onOpenChange(false);
    } catch (err) {
      toast.error("Couldn't join", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !joining && onOpenChange(next)}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Join a shared project</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (invite.trim() && !joining) handleJoin();
          }}
        >
          <Input
            autoFocus
            value={invite}
            onChange={(e) => setInvite(e.target.value)}
            placeholder="Invite code"
            className="font-mono text-sm"
          />
          <Input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Your name"
          />
          <Button
            type="submit"
            className="w-full"
            disabled={!invite.trim() || joining}
          >
            {joining && <Loader2Icon className="size-4 animate-spin" />}
            Join
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
