import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import styles from './Login.module.css';
import { FaEye, FaEyeSlash } from 'react-icons/fa';
import OtpInput from './OtpInput';

export default function Login({ initialMode = 'login' }) {
  const [isLogin, setIsLogin] = useState(initialMode !== 'register');
  const [forgotPasswordState, setForgotPasswordState] = useState('none'); // 'none', 'email', 'otp', 'new_password'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  
  // OTP States
  const [awaitingOtp, setAwaitingOtp] = useState(false);
  const [otp, setOtp] = useState('');
  const [isVerified, setIsVerified] = useState(false);
  const [resendTimer, setResendTimer] = useState(30);
  const [canResend, setCanResend] = useState(false);

  const { login, register, verifyOtp, resendOtp, forgotPassword, verifyResetOtp, resetPassword } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    let interval = null;
    if (awaitingOtp && !isVerified && resendTimer > 0) {
      interval = setInterval(() => {
        setResendTimer((prev) => prev - 1);
      }, 1000);
    } else if (resendTimer === 0) {
      setCanResend(true);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [awaitingOtp, isVerified, resendTimer]);

  const calculateStrength = (pass) => {
    let score = 0;
    if (!pass) return 0;
    if (pass.length >= 6) score += 1;
    if (pass.length >= 8) score += 1;
    if (/[A-Z]/.test(pass)) score += 1;
    if (/[0-9]/.test(pass)) score += 1;
    if (/[^A-Za-z0-9]/.test(pass)) score += 1;
    return score; // 0 to 5
  };

  const currentPass = forgotPasswordState === 'new_password' ? newPassword : password;
  const passStrength = calculateStrength(currentPass);
  const isPassGood = passStrength >= 3;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    try {
      if (isVerified) {
        navigate('/dashboard');
        return;
      }

      if (forgotPasswordState !== 'none') {
        if (forgotPasswordState === 'email') {
          await forgotPassword(email);
          setForgotPasswordState('otp');
          setAwaitingOtp(true);
          setResendTimer(30);
          setCanResend(false);
          setIsLoading(false);
          return;
        } else if (forgotPasswordState === 'otp') {
          await verifyResetOtp(email, otp);
          setForgotPasswordState('new_password');
          setIsLoading(false);
          return;
        } else if (forgotPasswordState === 'new_password') {
          if (!isPassGood) {
            setError('Please use a stronger password.');
            setIsLoading(false);
            return;
          }
          await resetPassword(email, otp, newPassword);
          setIsVerified(true);
          setIsLoading(false);
          return;
        }
      }

      if (awaitingOtp) {
        await verifyOtp(email, otp);
        setIsVerified(true);
        setIsLoading(false);
        return;
      }

      if (isLogin) {
        await login(email, password);
        navigate('/dashboard');
      } else {
        if (!isPassGood) {
          setError('Please use a stronger password.');
          setIsLoading(false);
          return;
        }
        const res = await register(name, email, password);
        if (res && res.awaitingOtp) {
          setAwaitingOtp(true);
          setEmail(res.email); // Ensure email is set
        } else {
          navigate('/dashboard'); // Direct login fallback
        }
      }
    } catch (err) {
      const data = err.response?.data;
      if (data?.error?.needsVerification) {
        setAwaitingOtp(true);
        setEmail(data.error.email || email);
        setError(data.error.message);
      } else if (data?.errors?.length > 0) {
        setError(data.errors[0].message);
      } else if (data?.error?.message) {
        setError(data.error.message);
      } else if (typeof data?.error === 'string') {
        setError(data.error);
      } else {
        setError(err.message || 'Authentication failed');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendOtp = async () => {
    if (!canResend) return;
    setError('');
    try {
      if (forgotPasswordState !== 'none') {
        await forgotPassword(email);
      } else {
        await resendOtp(email);
      }
      setError('OTP resent successfully to ' + email);
      setResendTimer(30);
      setCanResend(false);
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to resend OTP');
    }
  };

  const getTitle = () => {
    if (isVerified) return forgotPasswordState !== 'none' ? 'Password Reset Complete' : 'Registration Complete';
    if (forgotPasswordState !== 'none') {
      if (forgotPasswordState === 'email') return 'Forgot Password';
      if (forgotPasswordState === 'otp') return 'Verify OTP';
      return 'New Password';
    }
    return awaitingOtp ? 'Verify Your Email' : (isLogin ? 'Sign in to CommitSync' : 'Create an account');
  };

  const getSubtitle = () => {
    if (isVerified) return 'You are verified';
    if (forgotPasswordState !== 'none') {
      if (forgotPasswordState === 'email') return 'Enter your email to receive a password reset OTP';
      if (forgotPasswordState === 'otp') return `Enter the 6-digit OTP sent to ${email}`;
      return 'Create a strong new password';
    }
    return awaitingOtp 
      ? `Enter the 6-digit OTP sent to ${email}`
      : '';
  };

  const getSubmitText = () => {
    if (isLoading) return <span className={styles.loader}></span>;
    if (isVerified) return 'Enter';
    if (forgotPasswordState !== 'none') {
      if (forgotPasswordState === 'email') return 'Send OTP';
      if (forgotPasswordState === 'otp') return 'Verify OTP';
      return 'Reset Password';
    }
    return awaitingOtp ? 'Verify' : (isLogin ? 'Sign in' : 'Register');
  };

  const subtitleText = getSubtitle();

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <div className={styles.header}>
          <h2 className={styles.title}>{getTitle()}</h2>
          {subtitleText && <p className={styles.subtitle}>{subtitleText}</p>}
        </div>
        
        <form className={styles.form} onSubmit={handleSubmit}>
          {error && <div className={styles.errorMsg} style={{ color: error.includes('successfully') ? 'green' : '' }}>{error}</div>}
          
          <div className={styles.inputGroup}>
            {isVerified ? (
              // Verified View - Show checkmark
              <div style={{ display: 'flex', justifyContent: 'center', padding: '20px 0' }}>
                <svg className={styles.successCheckmark} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52 52">
                  <circle className={styles.checkmarkCircle} cx="26" cy="26" r="25" fill="none" />
                  <path className={styles.checkmarkPath} fill="none" d="M14.1 27.2l7.1 7.2 16.7-16.8" />
                </svg>
              </div>
            ) : (
              // Shared Form Fields
              <>
                {/* Registration Name Field */}
                {!isLogin && forgotPasswordState === 'none' && (
                  <input
                    name="name" 
                    type="text" 
                    required
                    className={styles.inputField}
                    placeholder="Full Name"
                    value={name} 
                    onChange={e => setName(e.target.value)}
                    disabled={awaitingOtp}
                  />
                )}
                
                {/* Email Field - Hidden only if entering new password */}
                {forgotPasswordState !== 'new_password' && (
                  <input
                    name="email" 
                    type="email" 
                    required
                    className={styles.inputField}
                    placeholder="Email address"
                    value={email} 
                    onChange={e => setEmail(e.target.value)}
                    disabled={awaitingOtp || (forgotPasswordState !== 'none' && awaitingOtp)}
                  />
                )}

                {/* Password Field - Shown in login, registration, and new_password state */}
                {(forgotPasswordState === 'none' || forgotPasswordState === 'new_password') && (
                  <div>
                    <div className={styles.passwordWrapper}>
                      <input
                        name={forgotPasswordState === 'new_password' ? "newPassword" : "password"} 
                        type={showPassword ? 'text' : 'password'}
                        required
                        className={styles.inputField}
                        placeholder={forgotPasswordState === 'new_password' ? "New Password" : "Password"}
                        value={forgotPasswordState === 'new_password' ? newPassword : password} 
                        onChange={e => forgotPasswordState === 'new_password' ? setNewPassword(e.target.value) : setPassword(e.target.value)}
                        disabled={forgotPasswordState === 'none' && awaitingOtp}
                      />
                      <button
                        type="button"
                        className={styles.passwordToggle}
                        onClick={() => setShowPassword(!showPassword)}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                      >
                        {showPassword ? <FaEyeSlash /> : <FaEye />}
                      </button>
                    </div>

                    {/* Password Strength Meter (Only for Register or New Password) */}
                    {(!isLogin || forgotPasswordState === 'new_password') && (!awaitingOtp || forgotPasswordState === 'new_password') && (
                      <div className={styles.strengthMeter}>
                        <div className={styles.strengthBarContainer}>
                          <div className={`${styles.strengthBar} ${passStrength >= 1 ? styles.strengthWeak : ''}`}></div>
                          <div className={`${styles.strengthBar} ${passStrength >= 2 ? styles.strengthFair : ''}`}></div>
                          <div className={`${styles.strengthBar} ${passStrength >= 3 ? styles.strengthGood : ''}`}></div>
                          <div className={`${styles.strengthBar} ${passStrength >= 4 ? styles.strengthStrong : ''}`}></div>
                        </div>
                        <span className={styles.strengthText}>
                          {passStrength === 0 && ' '}
                          {passStrength > 0 && passStrength < 3 && 'Weak password'}
                          {passStrength === 3 && 'Good password'}
                          {passStrength >= 4 && 'Strong password'}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {isLogin && forgotPasswordState === 'none' && !awaitingOtp && (
                  <div style={{ textAlign: 'right', marginTop: '-5px' }}>
                    <button 
                      type="button" 
                      className={styles.toggleBtn} 
                      onClick={() => { setForgotPasswordState('email'); setError(''); }} 
                      style={{ fontSize: '0.85rem' }}
                    >
                      Forgot Password?
                    </button>
                  </div>
                )}

                {/* OTP View */}
                {((forgotPasswordState === 'none' && awaitingOtp) || forgotPasswordState === 'otp') && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'center', width: '100%', marginTop: '10px' }}>
                    <OtpInput length={6} value={otp} onChange={setOtp} />
                    <div className={styles.resendContainer}>
                      {canResend ? (
                        <span>Didn't receive it? <button type="button" onClick={handleResendOtp} className={styles.resendBtn}>Resend OTP</button></span>
                      ) : (
                        <span>Resend OTP in <strong style={{ color: '#d35400' }}>{resendTimer}s</strong></span>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
          
          <button type="submit" className={styles.submitBtn} disabled={isLoading || ((!isLogin || forgotPasswordState === 'new_password') && (!awaitingOtp || forgotPasswordState === 'new_password') && !isPassGood)}>
            {getSubmitText()}
          </button>
        </form>
        
        {!awaitingOtp && !isVerified && (
          <>
            {forgotPasswordState === 'none' && (
              <>
                <div className={styles.divider}>
                  <span className={styles.dividerText}>Or continue with</span>
                </div>

                <button
                  onClick={() => {
                    const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';
                    window.location.href = `${apiBase}/auth/google`;
                  }}
                  className={styles.googleBtn}
                >
                  <svg className={styles.googleIcon} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M22.56 12.25C22.56 11.47 22.49 10.72 22.36 10H12V14.26H17.93C17.67 15.63 16.89 16.79 15.74 17.56V20.33H19.3C21.38 18.41 22.56 15.58 22.56 12.25Z" fill="#4285F4"/>
                    <path d="M12 23C14.97 23 17.46 22.02 19.3 20.33L15.74 17.56C14.75 18.23 13.48 18.63 12 18.63C9.13 18.63 6.7 16.7 5.82 14.12H2.15V16.97C3.96 20.57 7.68 23 12 23Z" fill="#34A853"/>
                    <path d="M5.82 14.12C5.59 13.45 5.46 12.74 5.46 12C5.46 11.26 5.59 10.55 5.82 9.88V7.03H2.15C1.41 8.51 1 10.2 1 12C1 13.8 1.41 15.49 2.15 16.97L5.82 14.12Z" fill="#FBBC05"/>
                    <path d="M12 5.38C13.62 5.38 15.06 5.94 16.2 7.03L19.39 3.84C17.45 2.03 14.97 1 12 1C7.68 1 3.96 3.43 2.15 7.03L5.82 9.88C6.7 7.3 9.13 5.38 12 5.38Z" fill="#EA4335"/>
                  </svg>
                  Continue with Google
                </button>
              </>
            )}

            <div className={styles.toggleContainer}>
              {forgotPasswordState !== 'none' ? (
                <button 
                  onClick={() => { setForgotPasswordState('none'); setError(''); }} 
                  className={styles.toggleBtn}
                >
                  Back to Sign In
                </button>
              ) : (
                <button onClick={() => setIsLogin(!isLogin)} className={styles.toggleBtn}>
                  {isLogin ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
