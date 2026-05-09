import type { ImgHTMLAttributes } from 'react'
import { iconUrl, iconUrlWebp } from '../utils/iconUrl'

interface IconProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  iconPath: string
}

export function Icon({ iconPath, ...rest }: IconProps) {
  return (
    <picture style={{ display: 'contents' }}>
      <source srcSet={iconUrlWebp(iconPath)} type="image/webp" />
      <img
        src={iconUrl(iconPath)}
        loading="lazy"
        decoding="async"
        {...rest}
      />
    </picture>
  )
}
