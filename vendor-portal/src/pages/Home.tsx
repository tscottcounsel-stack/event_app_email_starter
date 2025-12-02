import Card from "@/components/Card";

export default function Home() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Welcome</h1>
      <Card>
        <p className="text-gray-700 dark:text-gray-300">
          This is the starter Home page. Use the navbar to jump to Vendor/Organizer dashboards.
        </p>
      </Card>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card><p>Quick stat: Applications today — <b>12</b></p></Card>
        <Card><p>Pending approvals — <b>4</b></p></Card>
      </div>
    </div>
  );
}
