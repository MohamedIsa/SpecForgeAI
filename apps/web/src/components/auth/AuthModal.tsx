import { useState, type FormEvent } from "react";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { ErrorToast } from "@/components/ui/toast";
import { trpc } from "@/trpc";
import { useAuth } from "@/lib/auth-context";
import { signupInput, loginInput } from "@specforge/backend/validation";

type AuthMode = "login" | "signup";

const SHAKE_DURATION_MS = 400;

export function AuthModal() {
  const { setSession } = useAuth();
  const [mode, setMode] = useState<AuthMode>("login");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isShaking, setIsShaking] = useState(false);

  const signupMutation = trpc.auth.signup.useMutation({
    onSuccess: (result) => setSession(result),
    onError: (error) => triggerError(error.message),
  });
  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: (result) => setSession(result),
    onError: (error) => triggerError(error.message),
  });

  const isPending = mode === "signup" ? signupMutation.isPending : loginMutation.isPending;

  function triggerError(message: string) {
    setErrorMessage(message);
    setIsShaking(true);
    window.setTimeout(() => setIsShaking(false), SHAKE_DURATION_MS);
  }

  function handleModeChange(value: string) {
    setMode(value === "signup" ? "signup" : "login");
    setErrorMessage(null);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);

    if (mode === "signup") {
      const result = signupInput.safeParse({ fullName, email, password });
      if (!result.success) {
        triggerError(result.error.issues[0]?.message ?? "Please check your details and try again.");
        return;
      }
      signupMutation.mutate(result.data);
    } else {
      const result = loginInput.safeParse({ email, password });
      if (!result.success) {
        triggerError(result.error.issues[0]?.message ?? "Please check your details and try again.");
        return;
      }
      loginMutation.mutate(result.data);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div
        className={`w-[400px] rounded-2lg border border-modal-border bg-modal-bg p-lg ${
          isShaking ? "animate-sf-shake" : ""
        }`}
      >
        <div className="flex flex-col items-center gap-sm mb-lg">
          <div className="size-10 rounded-md flex items-center justify-center text-base font-bold bg-primary text-text-inverse">
            S
          </div>
          <span className="text-lg font-semibold text-text-inverse">SpecForge AI</span>
        </div>

        <Tabs value={mode} onValueChange={handleModeChange}>
          <TabsList className="w-full">
            <TabsTrigger value="login">Login</TabsTrigger>
            <TabsTrigger value="signup">Create Account</TabsTrigger>
          </TabsList>

          <TabsContent value={mode}>
            <form onSubmit={handleSubmit} className="flex flex-col gap-md" noValidate>
              {mode === "signup" && (
                <div className="flex flex-col gap-xs">
                  <label htmlFor="auth-full-name" className="text-xs font-medium text-text-secondary">
                    Full Name
                  </label>
                  <Input
                    id="auth-full-name"
                    value={fullName}
                    onChange={(event) => setFullName(event.target.value)}
                    hasError={Boolean(errorMessage)}
                    required
                  />
                </div>
              )}

              <div className="flex flex-col gap-xs">
                <label htmlFor="auth-email" className="text-xs font-medium text-text-secondary">
                  Email
                </label>
                <Input
                  id="auth-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  hasError={Boolean(errorMessage)}
                  required
                />
              </div>

              <div className="flex flex-col gap-xs">
                <div className="flex items-center justify-between">
                  <label htmlFor="auth-password" className="text-xs font-medium text-text-secondary">
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={() => triggerError("Password reset is not available yet.")}
                    className="text-xs text-text-secondary hover:text-text-inverse cursor-pointer"
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="relative">
                  <Input
                    id="auth-password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    hasError={Boolean(errorMessage)}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((visible) => !visible)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute right-sm top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-inverse cursor-pointer"
                  >
                    {showPassword ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
                  </button>
                </div>
                {errorMessage && <p className="text-xs text-error">{errorMessage}</p>}
              </div>

              <label className="flex items-center gap-sm text-sm text-text-secondary cursor-pointer">
                <Checkbox
                  checked={rememberMe}
                  onCheckedChange={(checked) => setRememberMe(checked === true)}
                />
                Remember me for 30 days
              </label>

              <Button
                type="submit"
                disabled={isPending}
                className="bg-gradient-to-r from-primary to-secondary"
              >
                {isPending
                  ? "Please wait..."
                  : mode === "signup"
                    ? "Create account"
                    : "Sign in"}
              </Button>
            </form>

            <div className="flex items-center gap-sm my-md">
              <div className="h-px flex-1 bg-modal-border" />
              <span className="text-2xs text-text-secondary">OR</span>
              <div className="h-px flex-1 bg-modal-border" />
            </div>

            <Button
              type="button"
              variant="outline"
              className="w-full border-modal-border bg-input-bg text-text-inverse hover:bg-modal-border"
              onClick={() => triggerError("GitHub sign-in is not available yet.")}
            >
              Continue with GitHub
            </Button>
          </TabsContent>
        </Tabs>
      </div>

      {errorMessage && (
        <ErrorToast message={errorMessage} onDismiss={() => setErrorMessage(null)} />
      )}
    </div>
  );
}
