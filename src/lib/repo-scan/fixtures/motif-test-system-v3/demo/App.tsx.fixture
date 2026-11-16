import { useEffect, useState, type ReactNode } from "react";
import {
  Alert, Avatar, Badge, Button, Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle,
  Checkbox, Field, Input, Modal, Select, Switch, Tabs, TabsContent, TabsList, TabsTrigger, Textarea,
} from "../src";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

const swatches = ["background", "surface", "muted", "border", "primary", "secondary", "success", "warning", "danger"];

export function App() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  const [modalOpen, setModalOpen] = useState(false);
  const [email, setEmail] = useState("");

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  const emailError = email && !email.includes("@") ? "Enter a valid email address." : undefined;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-12 px-4 py-10 sm:px-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Motif</h1>
          <p className="text-muted-foreground">A basic React design system styled with Tailwind CSS.</p>
        </div>
        <Switch label="Dark mode" checked={dark} onCheckedChange={setDark} />
      </header>

      <Section title="Color tokens">
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-9">
          {swatches.map((name) => (
            <div key={name} className="flex flex-col gap-1.5">
              <div className="h-14 rounded-md border border-border" style={{ background: `var(--${name})` }} />
              <code className="text-xs text-muted-foreground">{name}</code>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-3">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button loading>Saving</Button>
          <Button disabled>Disabled</Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm">Small</Button>
          <Button size="md">Medium</Button>
          <Button size="lg">Large</Button>
          <Button size="icon" variant="outline" aria-label="Add">+</Button>
        </div>
      </Section>

      <Section title="Badges & avatars">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>Neutral</Badge>
          <Badge variant="primary">Primary</Badge>
          <Badge variant="success">Active</Badge>
          <Badge variant="warning">Pending</Badge>
          <Badge variant="danger">Failed</Badge>
          <Badge variant="outline">Outline</Badge>
        </div>
        <div className="flex items-center gap-3">
          <Avatar name="Ada Lovelace" size="sm" />
          <Avatar name="Grace Hopper" />
          <Avatar name="Alan Turing" size="lg" />
        </div>
      </Section>

      <Section title="Alerts">
        <div className="grid gap-3 sm:grid-cols-2">
          <Alert title="Heads up">Your trial ends in 3 days.</Alert>
          <Alert variant="success" title="Deployed">Version 1.4.2 is live.</Alert>
          <Alert variant="warning" title="Storage almost full">You've used 92% of your quota.</Alert>
          <Alert variant="danger" title="Payment failed">Update your card to keep your plan.</Alert>
        </div>
      </Section>

      <Section title="Forms">
        <Card>
          <CardHeader>
            <CardTitle>Create account</CardTitle>
            <CardDescription>Fields wire labels, hints and errors automatically.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" required>
              <Input placeholder="Ada Lovelace" />
            </Field>
            <Field label="Email" required error={emailError} hint="We'll never share it.">
              <Input type="email" placeholder="ada@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="Role">
              <Select defaultValue="design">
                <option value="design">Designer</option>
                <option value="eng">Engineer</option>
                <option value="pm">Product manager</option>
              </Select>
            </Field>
            <Field label="Disabled">
              <Input disabled placeholder="Not editable" />
            </Field>
            <Field label="Bio" className="sm:col-span-2">
              <Textarea placeholder="Tell us a little about yourself" />
            </Field>
            <div className="flex flex-wrap gap-6 sm:col-span-2">
              <Checkbox label="Subscribe to newsletter" defaultChecked />
              <Switch label="Email notifications" defaultChecked />
            </div>
          </CardContent>
          <CardFooter className="justify-end">
            <Button variant="ghost">Cancel</Button>
            <Button>Create account</Button>
          </CardFooter>
        </Card>
      </Section>

      <Section title="Tabs">
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>
          <TabsContent value="overview"><p className="text-sm text-muted-foreground">Project overview goes here. Try the arrow keys.</p></TabsContent>
          <TabsContent value="activity"><p className="text-sm text-muted-foreground">Recent activity feed.</p></TabsContent>
          <TabsContent value="settings"><p className="text-sm text-muted-foreground">Project settings.</p></TabsContent>
        </Tabs>
      </Section>

      <Section title="Modal">
        <div>
          <Button variant="outline" onClick={() => setModalOpen(true)}>Delete project…</Button>
        </div>
        <Modal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          title="Delete project?"
          description="This permanently removes the project and all of its data. This can't be undone."
          footer={
            <>
              <Button variant="ghost" onClick={() => setModalOpen(false)}>Cancel</Button>
              <Button variant="danger" onClick={() => setModalOpen(false)}>Delete</Button>
            </>
          }
        />
      </Section>
    </div>
  );
}
