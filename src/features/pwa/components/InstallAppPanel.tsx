"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAppInstall } from "./AppInstallProvider";

export function InstallAppPanel() {
  const { canInstall, isStandalone, isIOS, status, error, install } = useAppInstall();
  const installed = isStandalone || status === "installed";

  return <Card className="mt-3">
    <CardHeader>
      <CardTitle>Install Chibako</CardTitle>
      <CardDescription>Open Chibako from your home screen or desktop in its own app window.</CardDescription>
    </CardHeader>
    <CardContent className="flex flex-col gap-4 text-sm">
      <p className="text-muted-foreground">Requires a connection to your Chibako server. Offline mode is not available yet.</p>
      <div role="status" aria-live="polite">
        {isStandalone && <p>You’re using the installed app.</p>}
        {!isStandalone && status === "installed" && <p>Chibako was installed. Open it from your app icon.</p>}
        {!installed && status === "accepted" && <p>Installation requested. Follow your device’s installation steps, then open Chibako from its app icon.</p>}
        {!installed && status === "dismissed" && <p>Installation dismissed. You can still install from your browser’s menu.</p>}
        {!installed && status === "prompting" && <p>Continue in your browser’s installation prompt.</p>}
      </div>
      {!installed && canInstall && <div>
        <Button className="min-h-11" onClick={() => void install()}>Install Chibako</Button>
      </div>}
      {!installed && error && <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>}
      {!installed && isIOS && <div className="flex flex-col gap-2">
        <h2 className="font-medium">On iPhone or iPad</h2>
        <p>Open Chibako in Safari, tap Share, then Add to Home Screen. Keep Open as Web App enabled if shown, then tap Add.</p>
      </div>}
      {!installed && !isIOS && <div className="flex flex-col gap-2">
        <h2 className="font-medium">Install from your browser</h2>
        <p>In Chrome or Edge on desktop, use the install icon in the address bar or Install app in the browser menu. On Android Chrome, open the menu and choose Add to Home screen or Install app.</p>
        <p className="text-muted-foreground">If no install option appears, try Chrome or Edge on desktop, Chrome on Android, or Safari on iPhone/iPad. A missing install button here does not mean the app is already installed.</p>
      </div>}
      {!installed && <p className="text-muted-foreground">Installation requires HTTPS, except on localhost for development. You may need to sign in again when you first open the installed app.</p>}
    </CardContent>
  </Card>;
}
