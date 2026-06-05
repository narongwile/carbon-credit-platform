<?php
/**
 * Template for the "Services" page (slug: services).
 *
 * @package thermexpertise
 */

$thex     = thex_company();
$services = thex_services();
get_header();
?>

<section class="page-hero">
	<div class="container">
		<div class="breadcrumb"><a href="<?php echo esc_url( home_url( '/' ) ); ?>"><?php esc_html_e( 'Home', 'thermexpertise' ); ?></a> &nbsp;/&nbsp; <?php esc_html_e( 'Services', 'thermexpertise' ); ?></div>
		<h1><?php esc_html_e( 'Our Services', 'thermexpertise' ); ?></h1>
		<p><?php esc_html_e( 'We offer a range of services to meet your needs — supporting private and government organizations through enhancement projects for S-curve industries, national strategy and planning, and collaborations with various ministries and institutes.', 'thermexpertise' ); ?></p>
	</div>
</section>

<section class="section">
	<div class="container">
		<div class="services">
			<?php foreach ( $services as $i => $svc ) : ?>
				<article class="service-card">
					<span class="num"><?php echo esc_html( sprintf( '%02d', $i + 1 ) ); ?></span>
					<div class="icon"><?php echo thex_icon( $svc['icon'] ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></div>
					<h3><?php echo esc_html( $svc['title'] ); ?></h3>
					<p><?php echo esc_html( $svc['desc'] ); ?></p>
					<?php if ( ! empty( $svc['items'] ) ) : ?>
						<ul>
							<?php foreach ( $svc['items'] as $item ) : ?>
								<li><?php echo esc_html( $item ); ?></li>
							<?php endforeach; ?>
						</ul>
					<?php endif; ?>
				</article>
			<?php endforeach; ?>
		</div>
	</div>
</section>

<section class="section section--soft">
	<div class="container">
		<div class="cta-band">
			<div>
				<h2><?php esc_html_e( 'Need a tailored engineering solution?', 'thermexpertise' ); ?></h2>
				<p><?php esc_html_e( 'All project descriptions are customized to specific client requirements.', 'thermexpertise' ); ?></p>
			</div>
			<a class="btn btn--ghost" href="<?php echo esc_url( home_url( '/contact/' ) ); ?>"><?php esc_html_e( 'Contact our team', 'thermexpertise' ); ?> <?php echo thex_icon( 'arrow' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></a>
		</div>
	</div>
</section>

<?php
get_footer();
