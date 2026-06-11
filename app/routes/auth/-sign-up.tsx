import { SignUp } from "@clerk/tanstack-react-start";
import { useRouterState } from "@tanstack/react-router";
import { clientAuthAppearance } from "@/lib/clerk-appearance";

export default function SignUpPage() {
  const search = useRouterState({
    select: (state) => state.location.searchStr,
  });
  const redirectUrl = new URLSearchParams(search).get("redirect_url");

  return (
    <SignUp
      fallbackRedirectUrl={redirectUrl || "/dashboard"}
      appearance={clientAuthAppearance}
    />
  );
}
