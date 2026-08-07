
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { useUser } from "@clerk/tanstack-react-start";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, Users, Mail, Check } from "lucide-react";
import { teamHomePath } from "@/lib/routes";
import { useInviteData } from "./-invite.data";

export default function InvitePage() {
  const params = useParams({ strict: false });
  const navigate = useNavigate({});
  const token = params.token as string;
  const { user, isLoaded } = useUser();

  const { invite } = useInviteData({ token });
  const acceptInvite = useMutation(api.teams.acceptInvite);

  const [isAccepting, setIsAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAccept = async () => {
    setIsAccepting(true);
    setError(null);
    try {
      const team = await acceptInvite({ token });
      if (team) {
        navigate({ to: teamHomePath(team.slug) });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to accept invite");
    } finally {
      setIsAccepting(false);
    }
  };

  if (invite === undefined || !isLoaded) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#FAFAFA]">
        <div className="text-[#6E6E73]">Loading…</div>
      </div>
    );
  }

  if (invite === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#FAFAFA] p-4 text-[#131315]">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[#FFF5F5]">
              <AlertCircle className="h-6 w-6 text-[#8A2B34]" />
            </div>
            <CardTitle>Invalid or expired invite</CardTitle>
            <CardDescription>
              This invite link is no longer valid. Please ask for a new invitation.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link to="/" preload="intent" className="block">
              <Button variant="outline" className="w-full">
                Go to snip
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  // User not signed in
  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#FAFAFA] p-4 text-[#131315]">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[#F1F1F3]">
              <Users className="h-6 w-6 text-[#6E6E73]" />
            </div>
            <CardTitle>You&apos;re invited to {invite.team?.name}</CardTitle>
            <CardDescription>
              {invite.invitedBy} has invited you to join as a {invite.role}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3 rounded-[11px] border border-[#E8E8EC] bg-[#FAFAFA] p-3">
              <Mail className="h-5 w-5 text-[#6E6E73]" />
              <div>
                <p className="text-sm text-[#6E6E73]">Invited email</p>
                <p className="font-semibold text-[#131315]">{invite.email}</p>
              </div>
            </div>
            <p className="text-center text-sm text-[#6E6E73]">
              Sign in with the email address above to accept this invite.
            </p>
            <a href={`/sign-in?redirect_url=${encodeURIComponent(`/invite/${token}`)}`} className="block">
              <Button className="w-full">Sign in to accept</Button>
            </a>
          </CardContent>
        </Card>
      </div>
    );
  }

  // User signed in but with different email
  if (user.primaryEmailAddress?.emailAddress !== invite.email) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#FAFAFA] p-4 text-[#131315]">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[#FFF9EC]">
              <AlertCircle className="h-6 w-6 text-[#74521D]" />
            </div>
            <CardTitle>Different email address</CardTitle>
            <CardDescription>
              This invite was sent to {invite.email}, but you&apos;re signed in as{" "}
              {user.primaryEmailAddress?.emailAddress}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-center text-sm text-[#6E6E73]">
              Please sign in with the correct email address to accept this invite.
            </p>
            <a href={`/sign-in?redirect_url=${encodeURIComponent(`/invite/${token}`)}`} className="block">
              <Button className="w-full" variant="outline">
                Sign in with different account
              </Button>
            </a>
          </CardContent>
        </Card>
      </div>
    );
  }

  // User signed in with correct email
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#FAFAFA] p-4 text-[#131315]">
      <Card className="max-w-md w-full">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[#F1F1F3]">
            <Users className="h-6 w-6 text-[#6E6E73]" />
          </div>
          <CardTitle>Join {invite.team?.name}</CardTitle>
          <CardDescription>
            {invite.invitedBy} has invited you to join as a{" "}
            <Badge variant="secondary">{invite.role}</Badge>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="rounded-[11px] bg-[#FFF5F5] p-3 text-sm text-[#8A2B34]">
              {error}
            </div>
          )}
          <Button
            className="w-full"
            onClick={handleAccept}
            disabled={isAccepting}
          >
            {isAccepting ? (
              "Joining…"
            ) : (
              <>
                <Check className="mr-2 h-4 w-4" />
                Accept invitation
              </>
            )}
          </Button>
          <Link to="/" preload="intent" className="block">
            <Button variant="ghost" className="w-full">
              Decline
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
