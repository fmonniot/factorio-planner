import type { ImgHTMLAttributes } from 'react'
import { iconUrl } from '../utils/iconUrl'

interface IconProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  iconPath: string
}

export function Icon({ iconPath, ...rest }: IconProps) {
  return (
    <img
      src={iconUrl(iconPath)}
      loading="lazy"
      decoding="async"
      {...rest}
    />
  )
}
