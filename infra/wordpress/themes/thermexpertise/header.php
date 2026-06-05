<?php
/**
 * Site header.
 *
 * @package thermexpertise
 */

$thex = thex_company();
?>
<!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
	<meta charset="<?php bloginfo( 'charset' ); ?>">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<?php wp_head(); ?>
</head>
<body <?php body_class(); ?>>
<?php wp_body_open(); ?>

<header class="site-header">
	<div class="container">
		<a class="brand" href="<?php echo esc_url( home_url( '/' ) ); ?>" aria-label="<?php echo esc_attr( $thex['name'] ); ?>">
			<?php if ( has_custom_logo() ) : ?>
				<?php the_custom_logo(); ?>
			<?php else : ?>
				<span class="brand__mark">TX</span>
				<span>
					<span class="brand__name">THERM EXPERTISE</span>
					<span class="brand__tag"><?php esc_html_e( 'Engineering Solutions', 'thermexpertise' ); ?></span>
				</span>
			<?php endif; ?>
		</a>

		<nav aria-label="<?php esc_attr_e( 'Primary', 'thermexpertise' ); ?>">
			<?php
			if ( has_nav_menu( 'primary' ) ) {
				wp_nav_menu(
					array(
						'theme_location' => 'primary',
						'container'      => false,
						'menu_class'     => 'nav',
						'menu_id'        => 'primary-menu',
						'depth'          => 1,
					)
				);
			} else {
				thex_fallback_menu();
			}
			?>
		</nav>

		<div class="header-actions">
			<a class="btn btn--primary" href="tel:<?php echo esc_attr( $thex['phone_raw'] ); ?>">
				<?php echo thex_icon( 'phone' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- trusted SVG. ?>
				<?php esc_html_e( 'Call Now!', 'thermexpertise' ); ?>
			</a>
			<button class="nav-toggle" aria-label="<?php esc_attr_e( 'Toggle menu', 'thermexpertise' ); ?>" aria-expanded="false">
				<span></span><span></span><span></span>
			</button>
		</div>
	</div>
</header>

<main id="main">
