import { ShieldCheck } from 'lucide-react';

export function Header() {
  return (
    <header className="bg-primary text-primary-foreground shadow-md">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex h-20 items-center justify-between">
          <div className="flex items-center">
            <ShieldCheck className="h-10 w-10 mr-3" />
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
              CSM AI Assistant
            </h1>
          </div>
          {/* Navigation items can be added here if needed */}
        </div>
      </div>
    </header>
  );
}
