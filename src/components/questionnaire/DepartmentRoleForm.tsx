
'use client';

import { useState, type FormEvent, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Building2, UserCog, User, Mail, Linkedin, ShieldCheck } from 'lucide-react';
import type { UserProfile } from '@/lib/types';

interface DepartmentRoleFormProps {
  onSubmit: (profile: UserProfile) => void;
  initialProfile?: UserProfile | null;
  isLoading?: boolean;
}

const nepraDepartments = [
  "Access Control",
  "Awareness and Training",
  "Audit and Accountability",
  "Configuration Management",
  "Incident Response",
  "Maintenance",
  "Media Protection",
  "Physical and Environmental Protection",
  "Planning",
  "Personnel Security",
  "Risk Assessment",
  "System and Communications Protection",
  "System and Information Integrity",
  "System and Services Acquisition",
  "Monitoring",
  "Vulnerability Assessment & Penetration Testing (VAPT)",
  "IT Operations", // General IT
  "OT Operations", // General OT
  "Security Policy", // Added from previous context
  "Reporting", // Added from previous context
  "SOC (Security Operations Center)", // Added from previous context
  "PowerCERT Coordination", // Added from previous context
  "Human Resources", // Common department
  "Legal", // Common department
  "Other", // Fallback
];

export function DepartmentRoleForm({ onSubmit, initialProfile, isLoading = false }: DepartmentRoleFormProps) {
  const [name, setName] = useState(initialProfile?.name || '');
  const [email, setEmail] = useState(initialProfile?.email || '');
  const [linkedin, setLinkedin] = useState(initialProfile?.linkedin || '');
  const [department, setDepartment] = useState(initialProfile?.department || '');
  const [role, setRole] = useState(initialProfile?.role || '');

  useEffect(() => {
    if (initialProfile) {
      setName(initialProfile.name || '');
      setEmail(initialProfile.email || '');
      setLinkedin(initialProfile.linkedin || '');
      setDepartment(initialProfile.department || '');
      setRole(initialProfile.role || '');
    }
  }, [initialProfile]);

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
          <ShieldCheck className="w-8 h-8 mr-2 text-primary" />
          User & Role Information
        </CardTitle>
        <CardDescription>
          Please provide your details. This information is crucial for tailoring the NEPRA compliance questionnaire and generating accurate reports.
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
              placeholder="e.g., Ahmed Khan"
              required
              className="text-base"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email" className="flex items-center text-base">
              <Mail className="w-5 h-5 mr-2 text-primary" />
              Official Email Address
            </Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="e.g., ahmed.khan@company.com.pk"
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
              placeholder="e.g., https://linkedin.com/in/ahmedkhan"
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
              placeholder="Select or type your department"
              list="nepra-departments-list"
              required
              className="text-base"
            />
            <datalist id="nepra-departments-list">
              {nepraDepartments.sort().map(dep => <option key={dep} value={dep} />)}
            </datalist>
            <p className="text-xs text-muted-foreground">Select from the list or type if not present. This aligns with NEPRA compliance areas.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="role" className="flex items-center text-base">
              <UserCog className="w-5 h-5 mr-2 text-primary" />
              Role / Designation
            </Label>
            <Input
              id="role"
              type="text"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="e.g., Compliance Officer, Security Analyst, Manager IT"
              required
              className="text-base"
            />
          </div>
        </CardContent>
        <CardFooter>
          <Button type="submit" className="w-full text-lg py-3" disabled={isLoading || !name || !email || !department || !role}>
            {isLoading ? 'Loading...' : 'Start Compliance Questionnaire'}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
