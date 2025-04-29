'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { signInWithEmailAndPassword, onAuthStateChanged } from 'firebase/auth';
import { auth } from '@/lib/firebase'; // Import centralized Firebase auth instance
import { LogIn, RefreshCw, AlertTriangle } from 'lucide-react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true); // Start checking auth immediately
  const [authUnavailable, setAuthUnavailable] = useState(false); // Track if auth service is missing
  const router = useRouter();
  const { toast } = useToast();

  // Check Firebase Auth availability on mount
   useEffect(() => {
     if (!auth) {
       setAuthUnavailable(true);
       setCheckingAuth(false); // Stop checking auth state if service is missing
     }
   }, []);


  // Check if user is already logged in
   useEffect(() => {
     if (!auth) { // Don't run if auth service isn't available
        setCheckingAuth(false);
        return;
     }

     // Set checkingAuth to true only if auth service is available
     setCheckingAuth(true);
     const unsubscribe = onAuthStateChanged(auth, (user) => {
       if (user) {
         router.push('/admin'); // Redirect to admin dashboard if already logged in
       } else {
         setCheckingAuth(false); // Allow login form render if not logged in
       }
     });
     return () => unsubscribe(); // Cleanup subscription
   }, [router]); // Only router dependency needed here

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth) { // Double check auth service is available before trying to use it
        toast({
           title: "Login Error",
           description: "Firebase Authentication service is not available.",
           variant: "destructive",
        });
       return;
    }
    setIsLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      toast({ title: "Login Successful", description: "Redirecting to admin panel..." });
      router.push('/admin'); // Redirect after successful login
    } catch (error: any) {
      console.error("Login Error:", error);
      let errorMessage = "Login failed. Please check your credentials.";
      // Keep existing error code checks
      if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
          errorMessage = "Invalid email or password.";
      } else if (error.code === 'auth/invalid-email') {
          errorMessage = "Please enter a valid email address.";
      } else if (error.code) { // Catch other Firebase auth errors
         errorMessage = `Login error: ${error.code}`;
      }
      toast({
        title: "Login Failed",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
        setIsLoading(false);
    }
  };

   // Display Auth Unavailable Error first if present
   if (authUnavailable) {
       return (
           <div className="flex justify-center items-center min-h-screen bg-gradient-to-br from-background to-secondary/30 p-4">
               <Card className="w-full max-w-md shadow-xl border border-destructive">
                   <CardHeader className="text-center">
                       <CardTitle className="text-destructive flex items-center justify-center gap-2">
                           <AlertTriangle className="h-6 w-6" /> Configuration Error
                       </CardTitle>
                   </CardHeader>
                   <CardContent>
                       <p className="text-center text-destructive-foreground">Firebase Authentication service is not available.</p>
                       <p className="text-center text-sm text-muted-foreground mt-2">Please ensure Firebase Authentication is correctly configured in your environment variables (.env file) and initialized properly.</p>
                   </CardContent>
               </Card>
           </div>
       );
   }

  // Show loading spinner while checking auth state (only if auth service is available)
  if (checkingAuth) {
     return (
       <div className="flex justify-center items-center min-h-screen">
         <RefreshCw className="h-8 w-8 animate-spin text-primary" />
       </div>
     );
   }

  // Render login form if auth is available and not currently checking state
  return (
    <div className="flex justify-center items-center min-h-screen bg-gradient-to-br from-background to-secondary/30 p-4">
      <Card className="w-full max-w-md shadow-xl border border-border rounded-lg">
        <CardHeader className="text-center">
          <CardTitle className="text-3xl font-bold text-primary">Admin Login</CardTitle>
          <CardDescription>Access the Bar Jukebox control panel.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="admin@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={isLoading} // Only disable while logging in
                className="text-base md:text-sm"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="********"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={isLoading} // Only disable while logging in
                className="text-base md:text-sm"
              />
            </div>
            <Button type="submit" className="w-full bg-primary hover:bg-primary/90 text-primary-foreground" disabled={isLoading}>
              {isLoading ? (
                 <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <LogIn className="mr-2 h-4 w-4" />
              )}
              {isLoading ? 'Logging In...' : 'Login'}
            </Button>
          </form>
        </CardContent>
         <CardFooter className="text-center text-sm text-muted-foreground">
             Use the credentials provided by the system administrator.
         </CardFooter>
      </Card>
    </div>
  );
}
