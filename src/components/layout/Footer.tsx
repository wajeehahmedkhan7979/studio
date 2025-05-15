
export function Footer() {
  return (
    <footer className="bg-secondary text-secondary-foreground py-6 mt-auto">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <p className="text-sm">
          &copy; {new Date().getFullYear()} SOFTWARE PRODUCTIVITY STRATAGISTS. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
