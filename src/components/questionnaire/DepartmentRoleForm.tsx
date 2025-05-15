
'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Building2, UserCog, User, Mail, Linkedin } from 'lucide-react';
import type { UserProfile } from '@/lib/types';

interface DepartmentRoleFormProps {
  onSubmit: (profile: UserProfile) => void;
  initialProfile?: UserProfile | null;
  isLoading?: boolean;
}

export function DepartmentRoleForm({ onSubmit, initialProfile, isLoading = false }: DepartmentRoleFormProps) {
  const [name, setName] = useState(initialProfile?.name || '');
  const [email, setEmail] = useState(initialProfile?.email || '');
  const [linkedin, setLinkedin] = useState(initialProfile?.linkedin || '');
  const [department, setDepartment] = useState(initialProfile?.department || '');
  const [role, setRole] = useState(initialProfile?.role || '');

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (name && email && department && role) {
      onSubmit({ name, email, linkedin, department, role });
    }
  };

  return (
    <Card className="w-full max-w-lg mx-auto shadow-xl">
      <CardHeader>
        <CardTitle className="flex items-center text-2xl">
          <ShieldCheckIcon className="w-8 h-8 mr-2 text-primary" />
          User Information
        </CardTitle>
        <CardDescription>
          Please provide your details and role to tailor the security questions.
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="name" className="flex items-center text-base">
              <User className="w-5 h-5 mr-2 text-primary" />
              Full Name
            </Label>
            <Input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., John Doe"
              required
              className="text-base"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email" className="flex items-center text-base">
              <Mail className="w-5 h-5 mr-2 text-primary" />
              Email Address
            </Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="e.g., john.doe@example.com"
              required
              className="text-base"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="linkedin" className="flex items-center text-base">
              <Linkedin className="w-5 h-5 mr-2 text-primary" />
              LinkedIn Profile (Optional)
            </Label>
            <Input
              id="linkedin"
              type="url"
              value={linkedin}
              onChange={(e) => setLinkedin(e.target.value)}
              placeholder="e.g., https://linkedin.com/in/johndoe"
              className="text-base"
            />
          </div>
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
          <Button type="submit" className="w-full text-lg py-3" disabled={isLoading || !name || !email || !department || !role}>
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
