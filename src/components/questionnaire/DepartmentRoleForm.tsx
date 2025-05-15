'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Building2, UserCog } from 'lucide-react';
import type { UserProfile } from '@/lib/types';

interface DepartmentRoleFormProps {
  onSubmit: (profile: UserProfile) => void;
  initialProfile?: UserProfile | null;
  isLoading?: boolean;
}

export function DepartmentRoleForm({ onSubmit, initialProfile, isLoading = false }: DepartmentRoleFormProps) {
  const [department, setDepartment] = useState(initialProfile?.department || '');
  const [role, setRole] = useState(initialProfile?.role || '');

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (department && role) {
      onSubmit({ department, role });
    }
  };

  return (
    <Card className="w-full max-w-md mx-auto shadow-xl">
      <CardHeader>
        <CardTitle className="flex items-center text-2xl">
          <ShieldCheckIcon className="w-8 h-8 mr-2 text-primary" />
          User Information
        </CardTitle>
        <CardDescription>
          Please provide your department and role to tailor the security questions.
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="department" className="flex items-center text-base">
              <Building2 className="w-5 h-5 mr-2 text-primary" />
              Department
            </Label>
            <Input
              id="department"
              type="text"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              placeholder="e.g., IT, Engineering, HR"
              required
              className="text-base"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="role" className="flex items-center text-base">
              <UserCog className="w-5 h-5 mr-2 text-primary" />
              Role
            </Label>
            <Input
              id="role"
              type="text"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="e.g., Manager, Analyst, Specialist"
              required
              className="text-base"
            />
          </div>
        </CardContent>
        <CardFooter>
          <Button type="submit" className="w-full text-lg py-3" disabled={isLoading}>
            {isLoading ? 'Loading...' : 'Start Questionnaire'}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

// Helper Icon (can be moved to a shared icon file if used elsewhere)
function ShieldCheckIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  )
}
