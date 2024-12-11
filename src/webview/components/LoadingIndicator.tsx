import React, { useEffect, useState } from 'react';
import styled from 'styled-components';

const Container = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  color: #8b949e;
  font-size: 14px;
`;

const Indicator = styled.div`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: #ffd700;
  box-shadow: 0 0 5px rgba(255, 215, 0, 0.5);
`;

const Text = styled.span`
  color: inherit;
`;

export const LoadingIndicator: React.FC = () => {
  const [dots, setDots] = useState('');

  useEffect(() => {
    const interval = setInterval(() => {
      setDots(prev => {
        if (prev.length >= 3) return '';
        return prev + '.';
      });
    }, 500);

    return () => clearInterval(interval);
  }, []);

  return (
    <Container>
      <Indicator />
      <Text>Generating{dots}</Text>
    </Container>
  );
};
