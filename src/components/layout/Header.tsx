
import { ShieldCheck } from 'lucide-react'; // ShieldCheck still seems appropriate

export function Header() {
  return (
    <header className="bg-primary text-primary-foreground shadow-md">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex h-20 items-center justify-between">
          <div className="flex items-center">
            <ShieldCheck className="h-10 w-10 mr-3" />
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
              Cybersecurity Compliance Agent (NEPRA)
            </h1>
          </div>
          {/* Navigation items can be added here if needed */}
        </div>
      </div>
    </header>
  );
}
