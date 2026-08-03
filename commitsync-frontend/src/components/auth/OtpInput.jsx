import React, { useState, useRef, useEffect } from 'react';
import styles from './Login.module.css';

const OtpInput = ({ length = 6, value, onChange }) => {
  const [otp, setOtp] = useState(new Array(length).fill(""));
  const inputRefs = useRef([]);

  useEffect(() => {
    if (value && value.length <= length) {
      const valueArr = value.split('');
      const newOtp = new Array(length).fill("");
      valueArr.forEach((char, index) => {
        newOtp[index] = char;
      });
      setOtp(newOtp);
    } else if (!value) {
      setOtp(new Array(length).fill(""));
    }
  }, [value, length]);

  const handleChange = (e, index) => {
    const val = e.target.value;
    if (isNaN(val)) return;

    const newOtp = [...otp];
    // allow only one character
    newOtp[index] = val.substring(val.length - 1);
    setOtp(newOtp);

    // trigger parent onChange
    const otpValue = newOtp.join('');
    onChange(otpValue);

    // move focus to next input if current is filled
    if (val && index < length - 1 && inputRefs.current[index + 1]) {
      inputRefs.current[index + 1].focus();
    }
  };

  const handleKeyDown = (e, index) => {
    // move to previous input on backspace if current is empty
    if (e.key === 'Backspace' && !otp[index] && index > 0 && inputRefs.current[index - 1]) {
      inputRefs.current[index - 1].focus();
    }
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData('text/plain').slice(0, length);
    if (!/^\d+$/.test(pastedData)) return; // Only allow numbers

    const newOtp = [...otp];
    for (let i = 0; i < pastedData.length; i++) {
      newOtp[i] = pastedData[i];
    }
    setOtp(newOtp);
    onChange(newOtp.join(''));

    // Focus the next empty input or the last one
    const focusIndex = Math.min(pastedData.length, length - 1);
    if (inputRefs.current[focusIndex]) {
      inputRefs.current[focusIndex].focus();
    }
  };

  return (
    <div className={styles.otpContainer} onPaste={handlePaste}>
      {otp.map((digit, index) => (
        <input
          key={index}
          type="text"
          maxLength={1}
          value={digit}
          onChange={(e) => handleChange(e, index)}
          onKeyDown={(e) => handleKeyDown(e, index)}
          ref={(reference) => (inputRefs.current[index] = reference)}
          className={styles.otpBox}
          autoFocus={index === 0}
          inputMode="numeric"
          pattern="\d*"
        />
      ))}
    </div>
  );
};

export default OtpInput;
