import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { MessageCircle } from 'lucide-react';
import styles from './StackedAvatars.module.css';

export default function StackedAvatars({ partners, onStartChat }) {
  const [hoveredIndex, setHoveredIndex] = useState(null);
  const [selectedPartner, setSelectedPartner] = useState(null);

  if (!partners || partners.length === 0) {
    return null;
  }

  return (
    <div className={styles.container}>
      
      <div className={styles.avatarStack}>
        {partners.map((partner, index) => {
          const isHovered = hoveredIndex === index;
          // Calculate spread offset when any avatar is hovered
          const offset = hoveredIndex !== null 
            ? (index - hoveredIndex) * 50 // Spread them apart
            : index * 15; // Default stack offset

          return (
            <motion.div
              key={partner._id || index}
              className={styles.avatarWrapper}
              initial={{ x: index * 15, zIndex: partners.length - index }}
              animate={{ 
                x: offset,
                scale: isHovered ? 1.1 : 1,
                zIndex: isHovered ? 100 : partners.length - index
              }}
              transition={{ type: "spring", stiffness: 300, damping: 20 }}
              onHoverStart={() => setHoveredIndex(index)}
              onHoverEnd={() => setHoveredIndex(null)}
              onClick={() => onStartChat(partner._id)}
            >
              <div className={styles.avatar}>
                {partner.profilePicture ? (
                  <img src={partner.profilePicture} alt={partner.name} />
                ) : (
                  <span>{partner.name?.charAt(0) || 'U'}</span>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
