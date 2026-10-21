import type { ImgHTMLAttributes } from 'react'
import { iconUrl, iconUrlWebp } from '../utils/iconUrl'

interface IconProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  iconPath: string
}

export function Icon({ iconPath, ...rest }: IconProps) {
  return (
    <picture style={{ display: 'contents' }}>
      {/* Hidden: under display: contents a visible <source> is a zero-width flex item that adds a gap */}
      <source srcSet={iconUrlWebp(iconPath)} type="image/webp" style={{ display: 'none' }} />
      <img
        src={iconUrl(iconPath)}
        loading="lazy"
        decoding="async"
        {...rest}
      />
    </picture>
  )
}
